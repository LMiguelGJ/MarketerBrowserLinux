import fs from 'node:fs';
import path from 'node:path';

/**
 * Engine abstraction over Playwright.
 *
 * The engine owns one browser context per profile. Every profile gets its own
 * user-data directory, so cookies and storage stay isolated between profiles
 * without sharing a browser profile.
 *
 * `driverFactory` exists so tests can inject a deterministic driver instead of
 * requiring a real browser binary.
 */
export class BrowserEngine {
  constructor({ profilesDir, engine = 'chromium', headless = true, sandbox = false, driverFactory }) {
    this.profilesDir = profilesDir;
    this.engine = engine;
    this.headless = headless;
    this.sandbox = sandbox;
    this.driverFactory = driverFactory ?? createPlaywrightDriver;
    this.sessions = new Map();
    // Opening a profile is guarded per profile: two concurrent requests must
    // not launch two browsers over the same user-data directory.
    this.opening = new Map();
  }

  profileDir(profileId) {
    // The identifier is a UUID issued by this service; it is validated before
    // it reaches this point, and the resolved path is checked again so a
    // malformed value can never escape the profiles directory.
    const dir = path.resolve(this.profilesDir, profileId);
    const root = path.resolve(this.profilesDir);
    if (dir !== root && !dir.startsWith(root + path.sep)) {
      throw Object.assign(new Error('invalid profile directory'), { status: 400 });
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Remove the on-disk browser data of a profile (cookies, storage, cache).
   * The target is resolved and checked against the profiles directory so an
   * identifier can never delete anything outside it.
   */
  removeProfileData(profileId) {
    if (this.sessions.has(profileId) || this.opening.has(profileId)) {
      throw Object.assign(new Error(`profile ${profileId} is still running`), { status: 409 });
    }
    const root = path.resolve(this.profilesDir);
    const dir = path.resolve(root, profileId);
    if (dir === root || !dir.startsWith(root + path.sep)) {
      throw Object.assign(new Error('invalid profile directory'), { status: 400 });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async open(profile, options = {}) {
    if (this.sessions.has(profile.id)) {
      throw Object.assign(new Error(`profile ${profile.id} is already running`), { status: 409 });
    }
    if (this.opening.has(profile.id)) {
      throw Object.assign(new Error(`profile ${profile.id} is already opening`), { status: 409 });
    }

    const pending = (async () => {
      const driver = await this.driverFactory({
        userDataDir: this.profileDir(profile.id),
        engine: this.engine,
        headless: this.headless,
        sandbox: this.sandbox,
        proxy: toPlaywrightProxy(options.proxy),
        cookies: options.cookies ?? [],
      });
      // The driver opens an initial page when the context is created; the
      // session adopts it so the viewer always has something to capture before
      // the first navigation.
      const session = { profileId: profile.id, driver, page: driver.page ?? null };
      this.sessions.set(profile.id, session);
      return session;
    })();

    this.opening.set(profile.id, pending);
    try {
      return await pending;
    } finally {
      this.opening.delete(profile.id);
    }
  }

  async close(profileId) {
    const pending = this.opening.get(profileId);
    if (pending) {
      // An open in flight must not outlive a close: wait for it and release
      // the browser it started.
      try {
        await pending;
      } catch {
        // The open failed; there is nothing to release.
      }
    }
    const session = this.sessions.get(profileId);
    if (!session) return false;
    this.sessions.delete(profileId);
    await session.driver.close();
    return true;
  }

  async closeAll() {
    for (const profileId of [...this.sessions.keys()]) {
      await this.close(profileId);
    }
  }

  session(profileId) {
    const session = this.sessions.get(profileId);
    if (!session) {
      throw Object.assign(new Error(`profile ${profileId} is not running`), { status: 409 });
    }
    return session;
  }

  isRunning(profileId) {
    return this.sessions.has(profileId);
  }

  async navigate(profileId, url) {
    const session = this.session(profileId);
    // A closed tab leaves the session without a page; a new one is opened so
    // the profile stays usable after closing its last tab.
    if (!session.page || session.page.isClosed?.()) {
      session.page = await session.driver.newPage();
    }
    session.page = await session.driver.navigate(url);
    return { url: session.page.url() };
  }

  async evaluate(profileId, expression) {
    const session = this.session(profileId);
    if (!session.page) throw Object.assign(new Error('no page open'), { status: 409 });
    return { result: await session.page.evaluate(expression) };
  }

  async closeTab(profileId) {
    const session = this.session(profileId);
    if (!session.page) throw Object.assign(new Error('no page open'), { status: 409 });
    await session.page.close();
    // The profile stays open with a fresh blank tab, so frames, screenshots
    // and navigation keep working.
    session.page = await session.driver.newPage();
    return { closed: true };
  }

  async frames(profileId) {
    const session = this.session(profileId);
    if (!session.page) throw Object.assign(new Error('no page open'), { status: 409 });
    return { frames: session.page.frames() };
  }

  async screenshot(profileId) {
    const session = this.session(profileId);
    if (!session.page) throw Object.assign(new Error('no page open'), { status: 409 });
    return { image: await session.page.screenshot({ type: 'png' }) };
  }

  async click(profileId, x, y) {
    const session = this.session(profileId);
    await session.driver.click(x, y);
    return { clicked: true };
  }

  async pressKey(profileId, key) {
    const session = this.session(profileId);
    await session.driver.pressKey(key);
    return { pressed: true };
  }

  async scroll(profileId, deltaY) {
    const session = this.session(profileId);
    await session.driver.scroll(deltaY);
    return { scrolled: true };
  }

  /**
   * Read or write the storage of the current page. `area` selects
   * localStorage or sessionStorage; `key` null reads the whole area.
   */
  async storage(profileId, { area = 'local', key = null, value = null } = {}) {
    const session = this.session(profileId);
    if (!session.page) throw Object.assign(new Error('no page open'), { status: 409 });
    if (!['local', 'session'].includes(area)) {
      throw Object.assign(new Error('area must be "local" or "session"'), { status: 400 });
    }
    if (key === null) {
      const entries = await session.page.evaluate(
        (target) => Object.entries(window[target]),
        area === 'local' ? 'localStorage' : 'sessionStorage',
      );
      return { area, entries };
    }
    if (value === null) {
      const current = await session.page.evaluate(
        ([target, name]) => window[target].getItem(name),
        [area === 'local' ? 'localStorage' : 'sessionStorage', key],
      );
      return { area, key, value: current };
    }
    await session.page.evaluate(
      ([target, name, next]) => window[target].setItem(name, next),
      [area === 'local' ? 'localStorage' : 'sessionStorage', key, String(value)],
    );
    return { area, key, value: String(value) };
  }

  /** Navigate every open tab back to a base URL. */
  async resetUrls(profileId, url) {
    const session = this.session(profileId);
    const pages = session.driver.pages();
    for (const page of pages) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    session.page = pages[0] ?? session.page;
    return { reset: pages.length, url };
  }
}

/**
 * Convert our proxy definition into the shape Playwright expects. Passing a
 * URL string silently produces an unrouted browser, so the conversion is
 * explicit and rejects unsupported schemes.
 */
export function toPlaywrightProxy(proxy) {
  if (!proxy) return null;
  const allowed = new Set(['http', 'https', 'socks4', 'socks5']);
  if (!allowed.has(proxy.type)) {
    throw Object.assign(new Error(`unsupported proxy type: ${proxy.type}`), { status: 400 });
  }
  const result = { server: `${proxy.type}://${proxy.host}:${proxy.port}` };
  if (proxy.username !== null && proxy.username !== undefined) {
    result.username = proxy.username;
    result.password = proxy.password ?? '';
  }
  return result;
}

/**
 * Resolve the Playwright browser type for the configured engine. An unknown
 * engine is rejected explicitly instead of silently falling back, so a typo
 * never hides which browser is actually running.
 */
export function resolveBrowserType(playwright, engine) {
  switch (engine) {
    case 'chromium':
      return playwright.chromium;
    case 'firefox':
      return playwright.firefox;
    case 'webkit':
      return playwright.webkit;
    default:
      throw Object.assign(new Error(`unsupported engine: ${engine}`), { status: 400 });
  }
}

async function createPlaywrightDriver({ userDataDir, engine, headless, sandbox, proxy, cookies }) {
  const playwright = await import('playwright');
  const browserType = resolveBrowserType(playwright, engine);
  // The sandbox is disabled only when the environment cannot provide it
  // (the container runs without user-namespace privileges).
  const launchOptions = { headless, args: sandbox ? [] : ['--no-sandbox'] };
  if (proxy) launchOptions.proxy = proxy;
  const context = await browserType.launchPersistentContext(userDataDir, launchOptions);

  // Stored cookies are restored into the context so a session survives a
  // close/reopen cycle of the profile.
  if (Array.isArray(cookies) && cookies.length > 0) {
    await context.addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path ?? '/',
        expires: cookie.expires ?? -1,
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true,
      })),
    );
  }

  // The active page is tracked instead of captured, so closing a tab does
  // not leave the driver pointing at a closed page.
  let activePage = context.pages()[0] ?? (await context.newPage());

  return {
    navigate: async (url) => {
      if (!activePage || activePage.isClosed()) {
        activePage = await context.newPage();
      }
      await activePage.goto(url, { waitUntil: 'domcontentloaded' });
      return activePage;
    },
    newPage: async () => {
      activePage = await context.newPage();
      return activePage;
    },
    pages: () => context.pages(),
    close: async () => {
      await context.close();
    },
    click: async (x, y) => {
      if (!activePage || activePage.isClosed()) return;
      await activePage.mouse.click(x, y);
    },
    pressKey: async (key) => {
      if (!activePage || activePage.isClosed()) return;
      await activePage.keyboard.press(key);
    },
    scroll: async (deltaY) => {
      if (!activePage || activePage.isClosed()) return;
      await activePage.mouse.wheel(0, deltaY);
    },
    get page() {
      return activePage;
    },
  };
}

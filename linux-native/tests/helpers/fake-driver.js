/**
 * Deterministic driver used by the integration suite.
 *
 * It mimics the surface the real Playwright driver exposes, so the API,
 * storage and profile lifecycle can be verified without downloading a browser
 * binary. The e2e suite exercises the real driver separately.
 *
 * `openDelayMs` makes the launch asynchronous, which is what exposes races in
 * the lifecycle: a driver that resolves in the same microtask hides them.
 */
export function createFakeDriverFactory(options = {}) {
  const { failOnNavigate = false, cookies = [], openDelayMs = 0 } = options;
  const state = {
    opened: [],
    closed: [],
    navigations: [],
    evaluations: [],
    pagesCreated: 0,
  };

  function createPage(storage) {
    state.pagesCreated += 1;
    let currentUrl = 'about:blank';
    let closed = false;

    return {
      url: () => currentUrl,
      isClosed: () => closed,
      evaluate: async (expression, argument) => {
        state.evaluations.push(typeof expression === 'function' ? 'function' : expression);
        // The engine evaluates storage through a function plus an argument:
        // a string target reads every entry, a two-item array reads one key
        // and a three-item array writes one key.
        if (typeof argument === 'string') {
          const area = argument === 'sessionStorage' ? storage.session : storage.local;
          return Object.entries(area);
        }
        if (Array.isArray(argument) && argument.length === 2) {
          const area = argument[0] === 'sessionStorage' ? storage.session : storage.local;
          return area[argument[1]] ?? null;
        }
        if (Array.isArray(argument) && argument.length === 3) {
          const area = argument[0] === 'sessionStorage' ? storage.session : storage.local;
          area[argument[1]] = argument[2];
          return null;
        }
        return { evaluated: expression };
      },
      goto: async (url) => {
        state.navigations.push(url);
        currentUrl = url;
      },
      close: async () => {
        closed = true;
        currentUrl = 'about:blank';
      },
      frames: () => [{ name: 'main', url: currentUrl }],
      screenshot: async () => {
        if (closed) throw new Error('page is closed');
        return Buffer.from('fake-png');
      },
    };
  }

  async function factory({ userDataDir, engine, headless, sandbox, proxy, cookies: restored }) {
    state.opened.push({ userDataDir, engine, headless, sandbox, proxy, cookies: restored });

    if (openDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, openDelayMs));
    }

    const storage = { local: {}, session: {} };
    const pages = [createPage(storage)];
    let active = pages[0];

    return {
      navigate: async (url) => {
        if (failOnNavigate) throw new Error('navigation failed');
        if (active.isClosed()) {
          active = createPage(storage);
          pages.push(active);
        }
        await active.goto(url);
        return active;
      },
      newPage: async () => {
        active = createPage(storage);
        pages.push(active);
        return active;
      },
      close: async () => {
        state.closed.push(userDataDir);
      },
      pages: () => pages.filter((candidate) => !candidate.isClosed()),
      click: async () => {},
      pressKey: async () => {},
      scroll: async () => {},
      get page() {
        return active;
      },
    };
  }

  factory.state = state;
  factory.cookies = cookies;
  return factory;
}

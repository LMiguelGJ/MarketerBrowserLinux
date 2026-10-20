import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/config.js';
import { Storage } from './src/storage.js';
import { BrowserEngine } from './src/browser-engine.js';
import { ViewerHub } from './src/viewer.js';
import {
  ValidationError,
  validateProfileName,
  newProfileId,
  nowIso,
  publicProfile,
  decodeProfileId,
} from './src/profiles.js';
import { validateCookieList } from './src/cookies.js';
import { validateProxy, proxyLabel, proxyUrl, parseProxyUrl } from './src/proxy.js';
import { exportBundle, parseBundle } from './src/import-export.js';
import { sendJson, sendError } from './src/http-errors.js';
import { isWebSocketUpgrade, handshake } from './src/websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...(options.config ?? {}) };
  const storage = options.storage ?? new Storage(config.dbFile);
  const engine =
    options.engine ??
    new BrowserEngine({
      profilesDir: config.profilesDir,
      engine: config.engine,
      headless: config.headless,
      sandbox: config.sandbox,
      driverFactory: options.driverFactory,
    });
  const viewer = new ViewerHub({ engine, storage });

  const tokenHash = config.authToken
    ? crypto.createHash('sha256').update(config.authToken).digest()
    : null;

  const SESSION_COOKIE = 'mbl_session';

  function readCookie(req, name) {
    const header = String(req.headers.cookie ?? '');
    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  function tokenMatches(candidate) {
    if (!tokenHash || !candidate) return false;
    const candidateHash = crypto.createHash('sha256').update(candidate).digest();
    return crypto.timingSafeEqual(candidateHash, tokenHash);
  }

  /**
   * Accepted credentials: a Bearer header, the session cookie and, only when
   * `allowQuery` is set, a `?token=` parameter. The query form exists for the
   * viewer WebSocket, which cannot send headers; on ordinary routes it would
   * leave the token in proxy logs and browser history, so it is refused there.
   */
  function authorized(req, { allowQuery = false } = {}) {
    if (!config.requireAuth) return true;
    if (!tokenHash) return false;
    const header = String(req.headers.authorization ?? '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const cookie = readCookie(req, SESSION_COOKIE);
    let query = '';
    if (allowQuery) {
      try {
        query = new URL(req.url, 'http://localhost').searchParams.get('token') ?? '';
      } catch {
        query = '';
      }
    }
    return tokenMatches(bearer) || tokenMatches(query) || tokenMatches(cookie);
  }

  /**
   * Issue the session cookie so the browser can open the viewer WebSocket,
   * which cannot carry an Authorization header. The cookie is HttpOnly and
   * Strict, and it only lives in the browser that already proved the token.
   */
  function issueSessionCookie(res, req) {
    if (!config.requireAuth || !config.authToken) return;
    const header = String(req.headers.authorization ?? '');
    if (!header.startsWith('Bearer ')) return;
    const secure = config.secureCookies ? '; Secure' : '';
    res.setHeader(
      'set-cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(config.authToken)}; HttpOnly; SameSite=Strict; Path=/${secure}`,
    );
  }

  /**
   * Reject cross-origin state-changing requests.
   *
   * The session cookie is SameSite=Strict, but a page served from another
   * port of the same host is still "same site", so the Origin header is
   * checked explicitly before any mutating call.
   */
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // Non-browser clients (curl, tests) send no Origin.
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    const host = String(req.headers.host ?? '');
    return parsed.host === host;
  }

  function requireAuth(req, res) {
    if (!originAllowed(req)) {
      sendJson(res, 403, { error: 'origin not allowed' });
      return false;
    }
    if (authorized(req)) {
      issueSessionCookie(res, req);
      return true;
    }
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        throw Object.assign(new Error('payload too large'), { status: 413 });
      }
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw Object.assign(new Error('body must be valid JSON'), { status: 400 });
    }
    // A bare `null`, an array or a scalar is not a request object.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('body must be a JSON object'), { status: 400 });
    }
    return parsed;
  }

  function serveStatic(_req, res, pathname) {
    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    try {
      relative = decodeURIComponent(relative);
    } catch {
      sendJson(res, 400, { error: 'malformed path' });
      return;
    }
    const target = path.resolve(PUBLIC_DIR, relative);
    // Prevent path traversal out of the public directory.
    if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  const routes = [];
  const route = (method, pattern, handler) => {
    routes.push({ method, pattern, handler });
  };

  // Every route that takes a profile id answers 404 for an unknown profile,
  // instead of returning an empty 200 or tripping a foreign-key error.
  function requireProfile(id) {
    const profile = storage.getProfile(id);
    if (!profile) throw Object.assign(new Error('profile not found'), { status: 404 });
    return profile;
  }

  route('GET', /^\/api\/health$/, async (_req, res) => {
    sendJson(res, 200, { status: 'ok', authRequired: config.requireAuth });
  });

  route('GET', /^\/api\/profiles$/, async (_req, res) => {
    sendJson(res, 200, { profiles: storage.listProfiles().map(publicProfile) });
  });

  route('POST', /^\/api\/profiles$/, async (req, res) => {
    const body = await readJson(req);
    const name = validateProfileName(body.name);
    if (storage.countProfiles() >= config.maxProfiles) {
      throw Object.assign(new Error(`profile limit reached (${config.maxProfiles})`), { status: 409 });
    }
    const proxy = validateProxy(body.proxy ?? null);
    const id = newProfileId();
    const now = nowIso();
    storage.createProfile({
      id,
      name,
      engine: config.engine,
      proxyUrl: proxyUrl(proxy),
      proxyLabel: proxyLabel(proxy),
      now,
    });
    storage.audit(id, 'profile.created', name, now);
    sendJson(res, 201, { profile: publicProfile(storage.getProfile(id)) });
  });

  route('GET', /^\/api\/profiles\/([^/]+)$/, async (_req, res, [id]) => {
    const profile = storage.getProfile(id);
    if (!profile) throw Object.assign(new Error('profile not found'), { status: 404 });
    sendJson(res, 200, { profile: publicProfile(profile) });
  });

  route('DELETE', /^\/api\/profiles\/([^/]+)$/, async (_req, res, [id]) => {
    const profile = requireProfile(id);
    // close() waits for an open in flight, so a browser started concurrently
    // is released before the profile disappears.
    await engine.close(id);
    viewer.dropChannel(id);
    // The browser data (cookies, storage) lives on disk; deleting the profile
    // must remove it too, not only the database rows.
    engine.removeProfileData(id);
    storage.deleteProfile(id);
    storage.audit(id, 'profile.deleted', profile.name, nowIso());
    sendJson(res, 200, { deleted: true });
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/open$/, async (_req, res, [id]) => {
    const profile = requireProfile(id);
    const proxy = parseProxyUrl(profile.proxy_url);
    // Stored cookies are restored into the browser so the session survives
    // a close/reopen cycle of the profile.
    const cookies = storage.listCookies(id);
    await engine.open(profile, { proxy, cookies });
    // The profile may have been deleted while the browser was starting.
    if (!storage.getProfile(id)) {
      await engine.close(id);
      throw Object.assign(new Error('profile not found'), { status: 404 });
    }
    storage.updateProfile(id, { status: 'running', updated_at: nowIso() });
    storage.audit(id, 'profile.opened', null, nowIso());
    sendJson(res, 200, { profile: publicProfile(storage.getProfile(id)) });
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/close$/, async (_req, res, [id]) => {
    requireProfile(id);
    await engine.close(id);
    viewer.dropChannel(id);
    storage.updateProfile(id, { status: 'stopped', updated_at: nowIso() });
    storage.audit(id, 'profile.closed', null, nowIso());
    sendJson(res, 200, { profile: publicProfile(storage.getProfile(id)) });
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/navigate$/, async (req, res, [id]) => {
    const body = await readJson(req);
    const url = String(body.url ?? '');
    if (!/^https?:\/\//i.test(url)) {
      throw new ValidationError('url must be an http(s) URL', 'url');
    }
    const result = await engine.navigate(id, url);
    storage.audit(id, 'profile.navigate', url, nowIso());
    sendJson(res, 200, result);
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/close-tab$/, async (_req, res, [id]) => {
    sendJson(res, 200, await engine.closeTab(id));
  });

  route('GET', /^\/api\/profiles\/([^/]+)\/frames$/, async (_req, res, [id]) => {
    const { frames } = await engine.frames(id);
    sendJson(res, 200, {
      frames: frames.map((frame) => ({ name: frame.name ?? '', url: frame.url ?? '' })),
    });
  });

  route('GET', /^\/api\/profiles\/([^/]+)\/screenshot$/, async (_req, res, [id]) => {
    const { image } = await engine.screenshot(id);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': image.length });
    res.end(image);
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/storage$/, async (req, res, [id]) => {
    const body = await readJson(req);
    const result = await engine.storage(id, {
      area: body.area === undefined ? 'local' : String(body.area),
      key: body.key === undefined || body.key === null ? null : String(body.key),
      value: body.value === undefined || body.value === null ? null : String(body.value),
    });
    sendJson(res, 200, result);
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/reset-urls$/, async (req, res, [id]) => {
    const body = await readJson(req);
    const url = String(body.url ?? '');
    if (!/^https?:\/\//i.test(url)) {
      throw new ValidationError('url must be an http(s) URL', 'url');
    }
    const result = await engine.resetUrls(id, url);
    storage.audit(id, 'profile.resetUrls', url, nowIso());
    sendJson(res, 200, result);
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/evaluate$/, async (req, res, [id]) => {
    const body = await readJson(req);
    const expression = String(body.expression ?? '');
    if (expression.length === 0) throw new ValidationError('expression is required', 'expression');
    const result = await engine.evaluate(id, expression);
    sendJson(res, 200, result);
  });

  route('GET', /^\/api\/profiles\/([^/]+)\/cookies$/, async (_req, res, [id]) => {
    requireProfile(id);
    sendJson(res, 200, { cookies: storage.listCookies(id) });
  });

  route('POST', /^\/api\/profiles\/([^/]+)\/cookies$/, async (req, res, [id]) => {
    requireProfile(id);
    const body = await readJson(req);
    const cookies = validateCookieList(body.cookies);
    storage.replaceCookies(id, cookies);
    storage.audit(id, 'cookies.replaced', String(cookies.length), nowIso());
    sendJson(res, 200, { cookies: storage.listCookies(id) });
  });

  route('GET', /^\/api\/profiles\/([^/]+)\/export$/, async (_req, res, [id]) => {
    const profile = requireProfile(id);
    const bundle = exportBundle({
      profile,
      cookies: storage.listCookies(id),
      proxy: parseProxyUrl(profile.proxy_url),
    });
    sendJson(res, 200, bundle);
  });

  route('POST', /^\/api\/import$/, async (req, res) => {
    const body = await readJson(req);
    const parsed = parseBundle(body);
    if (storage.countProfiles() >= config.maxProfiles) {
      throw Object.assign(new Error(`profile limit reached (${config.maxProfiles})`), { status: 409 });
    }
    const id = newProfileId();
    const now = nowIso();
    // Profile and cookies are written in one transaction: a failure leaves
    // no half-imported profile behind.
    storage.importProfile({
      id,
      name: parsed.name,
      engine: parsed.engine ?? config.engine,
      proxyUrl: proxyUrl(parsed.proxy),
      proxyLabel: proxyLabel(parsed.proxy),
      cookies: parsed.cookies,
      now,
    });
    storage.audit(id, 'profile.imported', String(parsed.cookies.length), now);
    sendJson(res, 201, { profile: publicProfile(storage.getProfile(id)) });
  });

  route('GET', /^\/api\/profiles\/([^/]+)\/audit$/, async (_req, res, [id]) => {
    requireProfile(id);
    sendJson(res, 200, { entries: storage.auditEntries(id) });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname.startsWith('/api/')) {
        if (pathname !== '/api/health' && !requireAuth(req, res)) return;
        for (const { method, pattern, handler } of routes) {
          if (req.method !== method) continue;
          const match = pattern.exec(pathname);
          if (!match) continue;
          await handler(req, res, match.slice(1).map(decodeProfileId));
          return;
        }
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      serveStatic(req, res, pathname);
    } catch (error) {
      sendError(res, error);
    }
  });

  const viewerSockets = new Set();

  server.on('upgrade', (req, socket) => {
    // A client that resets the connection emits 'error' on the raw socket.
    // Without a listener that becomes an uncaught exception and kills the
    // process, even before the client has authenticated.
    socket.on('error', () => socket.destroy());

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const match = /^\/api\/profiles\/([^/]+)\/viewer$/.exec(url.pathname);
    if (!match || !isWebSocketUpgrade(req)) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    if (!originAllowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    if (!authorized(req, { allowQuery: true })) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    let profileId;
    try {
      profileId = decodeProfileId(match[1]);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    if (!storage.getProfile(profileId)) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    handshake(req, socket);
    // Track upgraded sockets so a shutdown is not blocked by an open viewer.
    viewerSockets.add(socket);
    socket.on('close', () => viewerSockets.delete(socket));
    viewer.attach(profileId, socket);
  });

  async function close() {
    for (const socket of viewerSockets) socket.destroy();
    viewerSockets.clear();
    await engine.closeAll();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, storage, engine, viewer, config, close };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const app = createApp();
  const { host, port } = app.config;
  app.server.listen(port, host, () => {
    console.log(`mbl-linux-native listening on http://${host}:${port}`);
  });

  const shutdown = async () => {
    await app.close();
    app.storage.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

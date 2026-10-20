import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { createFakeDriverFactory } from '../helpers/fake-driver.js';

const TOKEN = 'viewer-token';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-viewer-'));
}

async function startApp(driverFactory = createFakeDriverFactory()) {
  const dataDir = tempDir();
  const app = createApp({
    config: {
      dataDir,
      dbFile: path.join(dataDir, 'mbl.sqlite'),
      profilesDir: path.join(dataDir, 'profiles'),
      authToken: TOKEN,
      requireAuth: true,
      maxProfiles: 2,
      engine: 'chromium',
      headless: true,
    },
    driverFactory,
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();

  const call = async (method, urlPath, body, headers = {}) => {
    const options = {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
    };
    // A GET must not carry a body; passing one is an invalid fetch option.
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };

  const cleanup = async () => {
    await app.close();
    app.storage.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { app, call, driverFactory, cleanup, port };
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const frames = [];
    const messages = [];

    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') messages.push(event.data);
      else frames.push(event.data);
    });
    socket.addEventListener('open', () => resolve({ socket, frames, messages }));
    socket.addEventListener('error', () => reject(new Error('websocket error')));
    setTimeout(() => reject(new Error('websocket did not open')), 5000);
  });
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * Issue a raw WebSocket upgrade and report the HTTP status the server
 * answered with. Returns 101 on success, or the rejection status.
 */
function rawUpgradeStatus(port, requestPath, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      port,
      host: '127.0.0.1',
      path: requestPath,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        ...(cookie ? { cookie } : {}),
      },
    });

    request.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    request.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
}

test('viewer channel requires authentication', async () => {
  const { call, cleanup, port } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    await assert.rejects(
      openSocket(`ws://127.0.0.1:${port}/api/profiles/${id}/viewer`),
      /websocket/i,
      'an unauthenticated viewer socket must not open',
    );
  } finally {
    await cleanup();
  }
});

test('viewer channel rejects an unknown profile', async () => {
  const { cleanup, port } = await startApp();
  try {
    await assert.rejects(
      openSocket(`ws://127.0.0.1:${port}/api/profiles/does-not-exist/viewer?token=${TOKEN}`),
      /websocket/i,
    );
  } finally {
    await cleanup();
  }
});

test('viewer channel streams a frame and forwards input to the engine', async () => {
  const driverFactory = createFakeDriverFactory();
  const { call, cleanup, port } = await startApp(driverFactory);
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    const { socket, frames } = await openSocket(
      `ws://127.0.0.1:${port}/api/profiles/${id}/viewer?token=${TOKEN}`,
    );

    await waitFor(() => frames.length > 0);
    assert.ok(frames[0] instanceof ArrayBuffer || frames[0] instanceof Blob);

    socket.send(JSON.stringify({ type: 'navigate', url: 'http://127.0.0.1:9999/' }));
    await waitFor(() => driverFactory.state.navigations.length > 0);
    assert.equal(driverFactory.state.navigations[0], 'http://127.0.0.1:9999/');

    socket.close();
  } finally {
    await cleanup();
  }
});

test('viewer channel for a stopped profile reports an error instead of streaming', async () => {
  const { call, cleanup, port } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;

    const { socket, messages } = await openSocket(
      `ws://127.0.0.1:${port}/api/profiles/${id}/viewer?token=${TOKEN}`,
    );
    await waitFor(() => messages.length > 0);
    assert.match(messages[0], /not running/);
    socket.close();
  } finally {
    await cleanup();
  }
});

test('an authenticated API call issues a session cookie usable by the viewer', async () => {
  const { call, cleanup } = await startApp();
  try {
    const response = await call('GET', '/api/profiles');
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie, 'expected a session cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(cookie.includes(TOKEN), true);
  } finally {
    await cleanup();
  }
});

test('the session cookie authenticates the viewer without a token in the url', async () => {
  const { call, cleanup, port } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    const listing = await call('GET', '/api/profiles');
    const cookie = listing.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('mbl_session='));

    // A browser sends its cookies on the upgrade request; a Node WebSocket
    // client cannot, so the upgrade is issued directly to observe the
    // server behaviour the browser depends on.
    const status = await rawUpgradeStatus(port, `/api/profiles/${id}/viewer`, { cookie });
    assert.equal(status, 101);

    const rejected = await rawUpgradeStatus(port, `/api/profiles/${id}/viewer`, {
      cookie: 'mbl_session=wrong-token',
    });
    assert.equal(rejected, 401);
  } finally {
    await cleanup();
  }
});

test('opening a profile with a proxy hands the engine a usable proxy definition', async () => {
  const driverFactory = createFakeDriverFactory();
  const { call, cleanup } = await startApp(driverFactory);
  try {
    const created = await call('POST', '/api/profiles', {
      name: 'Con proxy',
      proxy: { type: 'socks5', host: 'proxy.local', port: 1080, username: 'u', password: 'p' },
    });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    const entry = driverFactory.state.opened.at(-1);
    assert.deepEqual(entry.proxy, {
      server: 'socks5://proxy.local:1080',
      username: 'u',
      password: 'p',
    });
  } finally {
    await cleanup();
  }
});

test('a profile without proxy opens without proxy configuration', async () => {
  const driverFactory = createFakeDriverFactory();
  const { call, cleanup } = await startApp(driverFactory);
  try {
    const created = await call('POST', '/api/profiles', { name: 'Sin proxy' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    const entry = driverFactory.state.opened.at(-1);
    assert.equal(entry.proxy, null);
  } finally {
    await cleanup();
  }
});

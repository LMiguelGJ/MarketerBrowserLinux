import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { loadConfig } from '../../src/config.js';
import { Storage } from '../../src/storage.js';
import { BrowserEngine } from '../../src/browser-engine.js';
import { createFakeDriverFactory } from '../helpers/fake-driver.js';

/**
 * Regression suite for the defects found by the independent verification.
 * Each test is named after the finding it pins down (C = correctness,
 * S = hardening, D = documentation claim that needed a test).
 */

const TOKEN = 'regression-token';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startApp({ driverFactory = createFakeDriverFactory(), config = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-regression-'));
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
      ...config,
    },
    driverFactory,
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();

  const call = async (method, urlPath, body) => {
    const options = {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    return {
      status: response.status,
      body: contentType.includes('application/json') && text ? JSON.parse(text) : text,
      headers: response.headers,
    };
  };

  const cleanup = async () => {
    await app.close();
    app.storage.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { app, call, driverFactory, cleanup, port, dataDir };
}

/**
 * A request whose path is sent exactly as written. `fetch` and `URL` normalize
 * dot segments and percent-encoded dots, which would hide path-handling bugs.
 */
function rawRequest(port, method, requestPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        port,
        host: '127.0.0.1',
        method,
        path: requestPath,
        headers: { authorization: `Bearer ${TOKEN}`, ...headers },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** Issue a WebSocket upgrade and report the HTTP status the server chose. */
function rawUpgradeStatus(port, requestPath, headers = {}) {
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
        ...headers,
      },
    });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
}

async function createProfile(call, name = 'A') {
  const created = await call('POST', '/api/profiles', { name });
  return created.body.profile.id;
}

// ---------------------------------------------------------------- C1, C2

test('C1: abrupt client resets during an upgrade do not kill the process', async () => {
  const { port, call, cleanup } = await startApp();
  try {
    const request =
      'GET /api/profiles/abc/viewer HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\n' +
      'Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n';

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(request);
          socket.resetAndDestroy();
        });
        socket.on('error', () => {});
        socket.on('close', resolve);
      });
    }

    await sleep(100);
    const health = await call('GET', '/api/health');
    assert.equal(health.status, 200);
  } finally {
    await cleanup();
  }
});

test('C2: a malformed profile id on the viewer upgrade answers 400 and keeps the process alive', async () => {
  const { port, call, cleanup } = await startApp();
  try {
    const status = await rawUpgradeStatus(
      port,
      `/api/profiles/%E0%A4%A/viewer?token=${TOKEN}`,
    );
    assert.equal(status, 400);

    const health = await call('GET', '/api/health');
    assert.equal(health.status, 200);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------- C3, C4

test('C3: a cookie list with duplicates is rejected and the previous cookies survive', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createProfile(call);
    await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: 'example.com', path: '/', value: 'old' }],
    });

    const duplicated = await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [
        { name: 'a', domain: 'example.com', path: '/', value: '1' },
        { name: 'a', domain: 'example.com', path: '/', value: '2' },
      ],
    });
    assert.equal(duplicated.status, 400);

    const after = await call('GET', `/api/profiles/${id}/cookies`);
    assert.deepEqual(
      after.body.cookies.map((cookie) => `${cookie.name}=${cookie.value}`),
      ['sid=old'],
    );
  } finally {
    await cleanup();
  }
});

test('C3: storage rolls back a failed cookie replacement instead of leaving a partial set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-storage-'));
  const storage = new Storage(path.join(dir, 'db.sqlite'));
  try {
    storage.createProfile({ id: 'p1', name: 'A', engine: 'chromium', now: 't' });
    storage.replaceCookies('p1', [{ name: 'a', domain: 'd', path: '/', value: 'old' }]);

    const duplicate = { name: 'b', domain: 'd', path: '/', value: 'x' };
    assert.throws(() => storage.replaceCookies('p1', [duplicate, { ...duplicate, value: 'y' }]));

    assert.deepEqual(
      storage.listCookies('p1').map((cookie) => cookie.value),
      ['old'],
    );
  } finally {
    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C4: an import with duplicate cookies is rejected and creates no profile', async () => {
  const { call, cleanup } = await startApp();
  try {
    const bundle = {
      format: 'mbl-linux-native-profile',
      version: 1,
      profile: { name: 'Imported' },
      proxy: null,
      cookies: [
        { name: 'a', domain: 'example.com', path: '/', value: '1' },
        { name: 'a', domain: 'example.com', path: '/', value: '2' },
      ],
    };
    const rejected = await call('POST', '/api/import', bundle);
    assert.equal(rejected.status, 400);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 0);
  } finally {
    await cleanup();
  }
});

test('C4: storage imports a profile and its cookies in one transaction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-storage-'));
  const storage = new Storage(path.join(dir, 'db.sqlite'));
  try {
    const duplicate = { name: 'a', domain: 'd', path: '/', value: '1' };
    assert.throws(() =>
      storage.importProfile({
        id: 'p1',
        name: 'A',
        engine: 'chromium',
        cookies: [duplicate, { ...duplicate, value: '2' }],
        now: 't',
      }),
    );
    assert.equal(storage.getProfile('p1'), null);
    assert.equal(storage.countProfiles(), 0);
  } finally {
    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- C5, C6, C7

test('C5: two concurrent opens launch one browser and the other gets a conflict', async () => {
  const driverFactory = createFakeDriverFactory({ openDelayMs: 150 });
  const { call, cleanup } = await startApp({ driverFactory });
  try {
    const id = await createProfile(call);
    const [first, second] = await Promise.all([
      call('POST', `/api/profiles/${id}/open`),
      call('POST', `/api/profiles/${id}/open`),
    ]);

    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal(driverFactory.state.opened.length, 1);
  } finally {
    await cleanup();
  }
});

test('C6: deleting a profile while it is opening leaves no orphan browser', async () => {
  const driverFactory = createFakeDriverFactory({ openDelayMs: 200 });
  const { app, call, cleanup, dataDir } = await startApp({ driverFactory });
  try {
    const id = await createProfile(call);

    const opening = call('POST', `/api/profiles/${id}/open`);
    await sleep(40);
    const deleting = call('DELETE', `/api/profiles/${id}`);
    const [opened, deleted] = await Promise.all([opening, deleting]);

    assert.equal(deleted.status, 200);
    assert.ok([200, 404].includes(opened.status), `unexpected open status ${opened.status}`);
    assert.equal(app.engine.isRunning(id), false);
    assert.equal(driverFactory.state.closed.length, driverFactory.state.opened.length);
    assert.equal(app.storage.getProfile(id), null);
    assert.equal(fs.existsSync(path.join(dataDir, 'profiles', id)), false);
  } finally {
    await cleanup();
  }
});

test('C7: deleting a profile also removes its browser data from disk', async () => {
  const { call, cleanup, dataDir } = await startApp();
  try {
    const id = await createProfile(call);
    await call('POST', `/api/profiles/${id}/open`);

    const directory = path.join(dataDir, 'profiles', id);
    assert.equal(fs.existsSync(directory), true, 'the browser data directory must exist while open');

    const deleted = await call('DELETE', `/api/profiles/${id}`);
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(directory), false);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------- C8, C9

test('C8: a profile stays usable after closing its tab, even twice', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createProfile(call);
    await call('POST', `/api/profiles/${id}/open`);

    assert.equal((await call('POST', `/api/profiles/${id}/close-tab`)).status, 200);
    assert.equal((await call('POST', `/api/profiles/${id}/close-tab`)).status, 200);
    assert.equal((await call('GET', `/api/profiles/${id}/frames`)).status, 200);
    assert.equal((await call('GET', `/api/profiles/${id}/screenshot`)).status, 200);

    const navigated = await call('POST', `/api/profiles/${id}/navigate`, {
      url: 'http://127.0.0.1:9/',
    });
    assert.equal(navigated.status, 200);
  } finally {
    await cleanup();
  }
});

test('C9: a profile left as running by a previous process is reported as stopped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-storage-'));
  const file = path.join(dir, 'db.sqlite');
  try {
    const first = new Storage(file);
    first.createProfile({ id: 'p1', name: 'A', engine: 'chromium', now: 't' });
    first.updateProfile('p1', { status: 'running', updated_at: 't2' });
    assert.equal(first.getProfile('p1').status, 'running');
    first.close();

    const second = new Storage(file);
    assert.equal(second.getProfile('p1').status, 'stopped');
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- C10, C11

test('C10: malformed input answers 400, never 500', async () => {
  const { port, cleanup } = await startApp();
  try {
    const headers = { 'content-type': 'application/json' };

    const nullBody = await rawRequest(port, 'POST', '/api/profiles', { headers, body: 'null' });
    assert.equal(nullBody.status, 400);

    const arrayBody = await rawRequest(port, 'POST', '/api/profiles', { headers, body: '[1]' });
    assert.equal(arrayBody.status, 400);

    const brokenBody = await rawRequest(port, 'POST', '/api/profiles', { headers, body: '{' });
    assert.equal(brokenBody.status, 400);

    const badEscape = await rawRequest(port, 'GET', '/api/profiles/%E0%A4%A');
    assert.equal(badEscape.status, 400);
  } finally {
    await cleanup();
  }
});

test('C11: an unknown profile answers 404 on every profile route', async () => {
  const { call, cleanup } = await startApp();
  try {
    assert.equal((await call('GET', `/api/profiles/${UNKNOWN_ID}/cookies`)).status, 404);
    assert.equal((await call('GET', `/api/profiles/${UNKNOWN_ID}/audit`)).status, 404);
    assert.equal((await call('GET', `/api/profiles/${UNKNOWN_ID}/export`)).status, 404);
    assert.equal(
      (await call('POST', `/api/profiles/${UNKNOWN_ID}/cookies`, { cookies: [] })).status,
      404,
    );
    assert.equal(
      (
        await call('POST', `/api/profiles/${UNKNOWN_ID}/cookies`, {
          cookies: [{ name: 'a', domain: 'example.com', value: '1' }],
        })
      ).status,
      404,
    );
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------- D1

test('D1: profile identifiers cannot traverse the filesystem', async () => {
  const { port, cleanup } = await startApp();
  try {
    for (const attempt of ['%2e%2e', '..%2f..%2fetc', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '..']) {
      const response = await rawRequest(port, 'GET', `/api/profiles/${attempt}`);
      assert.ok(
        [400, 404].includes(response.status),
        `${attempt} answered ${response.status}`,
      );
    }
  } finally {
    await cleanup();
  }
});

test('D1: the engine refuses to resolve or delete a directory outside the profiles root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-engine-root-'));
  const profilesDir = path.join(root, 'profiles');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');

  try {
    const engine = new BrowserEngine({
      profilesDir,
      driverFactory: createFakeDriverFactory(),
    });

    assert.throws(() => engine.profileDir('../outside'), /invalid profile directory/);
    assert.throws(() => engine.removeProfileData('../outside'), /invalid profile directory/);
    assert.throws(() => engine.removeProfileData('..'), /invalid profile directory/);
    assert.equal(fs.existsSync(path.join(outside, 'keep.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- S1, S2, S5

test('S1: the session cookie is marked Secure only when the service is configured for TLS', async () => {
  const plain = await startApp();
  try {
    const response = await plain.call('GET', '/api/profiles');
    assert.doesNotMatch(response.headers.get('set-cookie'), /Secure/);
  } finally {
    await plain.cleanup();
  }

  const secure = await startApp({ config: { secureCookies: true } });
  try {
    const response = await secure.call('GET', '/api/profiles');
    assert.match(response.headers.get('set-cookie'), /; Secure/);
  } finally {
    await secure.cleanup();
  }
});

test('S2: a cross-origin request is rejected before it can change anything', async () => {
  const { port, call, cleanup } = await startApp();
  try {
    const headers = { 'content-type': 'application/json' };
    const body = JSON.stringify({ name: 'Cross origin' });

    const foreign = await rawRequest(port, 'POST', '/api/profiles', {
      headers: { ...headers, origin: 'http://evil.example' },
      body,
    });
    assert.equal(foreign.status, 403);

    const sameOrigin = await rawRequest(port, 'POST', '/api/profiles', {
      headers: { ...headers, origin: `http://127.0.0.1:${port}` },
      body,
    });
    assert.equal(sameOrigin.status, 201);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 1);
  } finally {
    await cleanup();
  }
});

test('S2: the viewer upgrade also checks the origin', async () => {
  const { port, call, cleanup } = await startApp();
  try {
    const id = await createProfile(call);
    await call('POST', `/api/profiles/${id}/open`);

    const foreign = await rawUpgradeStatus(
      port,
      `/api/profiles/${id}/viewer?token=${TOKEN}`,
      { origin: 'http://evil.example' },
    );
    assert.equal(foreign, 403);
  } finally {
    await cleanup();
  }
});

test('D5: the token in the query string is accepted only on the viewer upgrade', async () => {
  const { port, call, cleanup } = await startApp();
  try {
    // An ordinary route must not accept the token from the URL: it would end
    // up in proxy logs and browser history.
    const viaQuery = await rawRequest(port, 'GET', `/api/profiles?token=${TOKEN}`, {
      headers: { authorization: '' },
    });
    assert.equal(viaQuery.status, 401);

    const id = await createProfile(call);
    await call('POST', `/api/profiles/${id}/open`);
    const upgrade = await rawUpgradeStatus(port, `/api/profiles/${id}/viewer?token=${TOKEN}`);
    assert.equal(upgrade, 101);
  } finally {
    await cleanup();
  }
});

test('S5: authentication cannot be disabled on a non-loopback interface', () => {
  assert.throws(
    () => loadConfig({ MBL_REQUIRE_AUTH: 'false', MBL_HOST: '0.0.0.0' }),
    /Refusing to start without authentication/,
  );
  assert.doesNotThrow(() => loadConfig({ MBL_REQUIRE_AUTH: 'false', MBL_HOST: '127.0.0.1' }));
  assert.doesNotThrow(() => loadConfig({ MBL_REQUIRE_AUTH: 'true', MBL_HOST: '0.0.0.0' }));
});

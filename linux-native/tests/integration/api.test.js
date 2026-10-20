import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { createFakeDriverFactory } from '../helpers/fake-driver.js';

const TOKEN = 'test-token';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-test-'));
}

async function startApp() {
  const dataDir = tempDir();
  const driverFactory = createFakeDriverFactory();
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

  const call = async (method, urlPath, body, { token = TOKEN, raw = false } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return raw ? { response, payload } : { status: response.status, body: payload };
  };

  const cleanup = async () => {
    await app.engine.closeAll();
    await new Promise((resolve) => app.server.close(resolve));
    app.storage.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { app, call, driverFactory, cleanup, dataDir };
}

test('health endpoint is reachable and reports whether auth is required', async () => {
  const { call, cleanup } = await startApp();
  try {
    const { status, body } = await call('GET', '/api/health', undefined, { token: null });
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.authRequired, true);
  } finally {
    await cleanup();
  }
});

test('protected endpoints reject missing and wrong credentials', async () => {
  const { call, cleanup } = await startApp();
  try {
    const missing = await call('GET', '/api/profiles', undefined, { token: null });
    assert.equal(missing.status, 401);

    const wrong = await call('GET', '/api/profiles', undefined, { token: 'wrong' });
    assert.equal(wrong.status, 401);

    const valid = await call('GET', '/api/profiles');
    assert.equal(valid.status, 200);
  } finally {
    await cleanup();
  }
});

test('creating a profile persists it and exposes no proxy credentials', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', {
      name: 'Cuenta A',
      proxy: { type: 'http', host: 'proxy.local', port: 8080, username: 'u', password: 'secret' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.profile.name, 'Cuenta A');
    assert.equal(created.body.profile.status, 'stopped');
    assert.equal(created.body.profile.proxy, 'http://proxy.local:8080 (auth)');
    assert.equal(JSON.stringify(created.body).includes('secret'), false);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 1);
    assert.equal(listed.body.profiles[0].id, created.body.profile.id);
  } finally {
    await cleanup();
  }
});

test('invalid profile input is rejected and stores nothing', async () => {
  const { call, cleanup } = await startApp();
  try {
    const invalid = await call('POST', '/api/profiles', { name: '' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.field, 'name');

    const badProxy = await call('POST', '/api/profiles', {
      name: 'A',
      proxy: { type: 'ftp', host: 'h', port: 21 },
    });
    assert.equal(badProxy.status, 400);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 0);
  } finally {
    await cleanup();
  }
});

test('profile limit is enforced', async () => {
  const { call, cleanup } = await startApp();
  try {
    await call('POST', '/api/profiles', { name: 'A' });
    await call('POST', '/api/profiles', { name: 'B' });
    const third = await call('POST', '/api/profiles', { name: 'C' });
    assert.equal(third.status, 409);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 2);
  } finally {
    await cleanup();
  }
});

test('opening and closing a profile updates its status and audit trail', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;

    const opened = await call('POST', `/api/profiles/${id}/open`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.profile.status, 'running');

    const closed = await call('POST', `/api/profiles/${id}/close`);
    assert.equal(closed.body.profile.status, 'stopped');

    const audit = await call('GET', `/api/profiles/${id}/audit`);
    const actions = audit.body.entries.map((entry) => entry.action);
    assert.deepEqual(actions, ['profile.created', 'profile.opened', 'profile.closed']);
  } finally {
    await cleanup();
  }
});

test('navigate rejects non-http urls and accepts http urls', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);

    const rejected = await call('POST', `/api/profiles/${id}/navigate`, { url: 'file:///etc/passwd' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.field, 'url');

    const accepted = await call('POST', `/api/profiles/${id}/navigate`, { url: 'http://127.0.0.1:8080/' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.url, 'http://127.0.0.1:8080/');
  } finally {
    await cleanup();
  }
});

test('cookies are replaced atomically and invalid cookies leave storage unchanged', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;

    const valid = await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: 'example.com', path: '/', value: 'abc' }],
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.cookies.length, 1);

    const invalid = await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'bad name', domain: 'example.com', value: 'x' }],
    });
    assert.equal(invalid.status, 400);

    const after = await call('GET', `/api/profiles/${id}/cookies`);
    assert.equal(after.body.cookies.length, 1);
    assert.equal(after.body.cookies[0].name, 'sid');
  } finally {
    await cleanup();
  }
});

test('export then import creates a second profile with the same cookies', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: 'example.com', path: '/', value: 'abc' }],
    });

    const bundle = await call('GET', `/api/profiles/${id}/export`);
    assert.equal(bundle.status, 200);
    assert.equal(bundle.body.format, 'mbl-linux-native-profile');

    const imported = await call('POST', '/api/import', bundle.body);
    assert.equal(imported.status, 201);
    assert.notEqual(imported.body.profile.id, id);

    const cookies = await call('GET', `/api/profiles/${imported.body.profile.id}/cookies`);
    assert.equal(cookies.body.cookies.length, 1);
    assert.equal(cookies.body.cookies[0].value, 'abc');
  } finally {
    await cleanup();
  }
});

test('invalid import is rejected and creates nothing', async () => {
  const { call, cleanup } = await startApp();
  try {
    const invalid = await call('POST', '/api/import', { format: 'other', version: 1 });
    assert.equal(invalid.status, 400);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 0);
  } finally {
    await cleanup();
  }
});

test('deleting a profile removes it and its cookies', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: 'example.com', value: 'abc' }],
    });

    const deleted = await call('DELETE', `/api/profiles/${id}`);
    assert.equal(deleted.status, 200);

    const listed = await call('GET', '/api/profiles');
    assert.equal(listed.body.profiles.length, 0);
  } finally {
    await cleanup();
  }
});

test('opening the same profile twice reports a conflict', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    const again = await call('POST', `/api/profiles/${id}/open`);
    assert.equal(again.status, 409);
  } finally {
    await cleanup();
  }
});

test('each profile gets its own user data directory', async () => {
  const { call, driverFactory, cleanup } = await startApp();
  try {
    const a = await call('POST', '/api/profiles', { name: 'A' });
    const b = await call('POST', '/api/profiles', { name: 'B' });
    await call('POST', `/api/profiles/${a.body.profile.id}/open`);
    await call('POST', `/api/profiles/${b.body.profile.id}/open`);

    const dirs = driverFactory.state.opened.map((entry) => entry.userDataDir);
    assert.equal(dirs.length, 2);
    assert.notEqual(dirs[0], dirs[1]);
  } finally {
    await cleanup();
  }
});

test('unknown routes answer 404 and unknown profile ids answer 404', async () => {
  const { call, cleanup } = await startApp();
  try {
    const missingRoute = await call('GET', '/api/nope');
    assert.equal(missingRoute.status, 404);

    const missingProfile = await call('GET', '/api/profiles/does-not-exist');
    assert.equal(missingProfile.status, 404);
  } finally {
    await cleanup();
  }
});

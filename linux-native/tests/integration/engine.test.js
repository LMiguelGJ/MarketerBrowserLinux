import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { createFakeDriverFactory } from '../helpers/fake-driver.js';

const TOKEN = 'engine-token';

async function startApp(driverFactory = createFakeDriverFactory()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-engine-'));
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
      contentType,
    };
  };

  const cleanup = async () => {
    await app.close();
    app.storage.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { app, call, driverFactory, cleanup, port };
}

async function createRunningProfile(call, name = 'A') {
  const created = await call('POST', '/api/profiles', { name });
  const id = created.body.profile.id;
  await call('POST', `/api/profiles/${id}/open`);
  return id;
}

test('closing a tab reports the closure', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const closed = await call('POST', `/api/profiles/${id}/close-tab`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.closed, true);
  } finally {
    await cleanup();
  }
});

test('frames are listed with their names and urls', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const frames = await call('GET', `/api/profiles/${id}/frames`);
    assert.equal(frames.status, 200);
    assert.equal(Array.isArray(frames.body.frames), true);
    assert.equal(frames.body.frames.length, 1);
    assert.equal(frames.body.frames[0].name, 'main');
  } finally {
    await cleanup();
  }
});

test('the screenshot endpoint returns a png image', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const shot = await call('GET', `/api/profiles/${id}/screenshot`);
    assert.equal(shot.status, 200);
    assert.equal(shot.contentType, 'image/png');
    assert.ok(shot.body.length > 0);
  } finally {
    await cleanup();
  }
});

test('storage writes and reads back a value', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const written = await call('POST', `/api/profiles/${id}/storage`, {
      area: 'local',
      key: 'token',
      value: 'abc',
    });
    assert.equal(written.status, 200);
    assert.equal(written.body.value, 'abc');

    const read = await call('POST', `/api/profiles/${id}/storage`, {
      area: 'local',
      key: 'token',
    });
    assert.equal(read.body.value, 'abc');
  } finally {
    await cleanup();
  }
});

test('storage rejects an unknown area', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const rejected = await call('POST', `/api/profiles/${id}/storage`, { area: 'cookies' });
    assert.equal(rejected.status, 400);
  } finally {
    await cleanup();
  }
});

test('reset urls navigates every tab back to a base url', async () => {
  const driverFactory = createFakeDriverFactory();
  const { call, cleanup, driverFactory: _unused } = await startApp(driverFactory);
  try {
    const id = await createRunningProfile(call);
    const reset = await call('POST', `/api/profiles/${id}/reset-urls`, {
      url: 'http://127.0.0.1:8080/home',
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.url, 'http://127.0.0.1:8080/home');
    assert.ok(driverFactory.state.navigations.includes('http://127.0.0.1:8080/home'));
  } finally {
    await cleanup();
  }
});

test('reset urls rejects a non-http url', async () => {
  const { call, cleanup } = await startApp();
  try {
    const id = await createRunningProfile(call);
    const rejected = await call('POST', `/api/profiles/${id}/reset-urls`, {
      url: 'file:///etc/passwd',
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.field, 'url');
  } finally {
    await cleanup();
  }
});

test('engine operations on a stopped profile report a conflict', async () => {
  const { call, cleanup } = await startApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'A' });
    const id = created.body.profile.id;

    const frames = await call('GET', `/api/profiles/${id}/frames`);
    assert.equal(frames.status, 409);

    const shot = await call('GET', `/api/profiles/${id}/screenshot`);
    assert.equal(shot.status, 409);
  } finally {
    await cleanup();
  }
});

test('closing a profile releases its browser and marks it stopped', async () => {
  const driverFactory = createFakeDriverFactory();
  const { call, cleanup } = await startApp(driverFactory);
  try {
    const id = await createRunningProfile(call);
    const closed = await call('POST', `/api/profiles/${id}/close`);
    assert.equal(closed.body.profile.status, 'stopped');
    assert.equal(driverFactory.state.closed.length, 1);

    const reopened = await call('POST', `/api/profiles/${id}/open`);
    assert.equal(reopened.body.profile.status, 'running');
    assert.equal(driverFactory.state.opened.length, 2);
  } finally {
    await cleanup();
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { startTestSite } from '../fixtures/site/server.js';

const TOKEN = 'e2e-token';

/**
 * End-to-end suite.
 *
 * It uses the real Playwright driver and a real browser binary. When the
 * browser is not installed the suite reports that fact instead of silently
 * passing: `playwright install chromium` is required.
 */
async function browserAvailable() {
  try {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    return Boolean(executable) && fs.existsSync(executable);
  } catch {
    return false;
  }
}

const hasBrowser = await browserAvailable();

test('vertical slice: create, open, view, interact, close and persist', { skip: hasBrowser ? false : 'chromium binary not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-e2e-'));
  const site = await startTestSite();
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
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();

  const call = async (method, urlPath, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return { status: response.status, body: payload };
  };

  try {
    const created = await call('POST', '/api/profiles', { name: 'E2E A' });
    assert.equal(created.status, 201);
    const id = created.body.profile.id;

    const opened = await call('POST', `/api/profiles/${id}/open`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.profile.status, 'running');

    const navigated = await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });
    assert.equal(navigated.status, 200);

    const evaluated = await call('POST', `/api/profiles/${id}/evaluate`, {
      expression: `document.getElementById('title').textContent`,
    });
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.body.result, 'MBL test site');

    const typed = await call('POST', `/api/profiles/${id}/evaluate`, {
      expression: `(() => { document.getElementById('field').value = 'sintetico'; return document.getElementById('field').value; })()`,
    });
    assert.equal(typed.body.result, 'sintetico');

    await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: '127.0.0.1', path: '/', value: 'abc' }],
    });

    const closed = await call('POST', `/api/profiles/${id}/close`);
    assert.equal(closed.body.profile.status, 'stopped');

    const reopened = await call('POST', `/api/profiles/${id}/open`);
    assert.equal(reopened.body.profile.status, 'running');

    const cookiesAfter = await call('GET', `/api/profiles/${id}/cookies`);
    assert.equal(cookiesAfter.body.cookies.length, 1);
    assert.equal(cookiesAfter.body.cookies[0].value, 'abc');
  } finally {
    await app.engine.closeAll();
    await new Promise((resolve) => app.server.close(resolve));
    app.storage.close();
    await site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('real browser: local storage is written, read back and the screenshot works', { skip: hasBrowser ? false : 'chromium binary not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-e2e-storage-'));
  const site = await startTestSite();
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
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const call = async (method, urlPath, body) => {
    const options = {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    };
    if (body !== undefined && method !== 'GET') options.body = JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    const created = await call('POST', '/api/profiles', { name: 'Storage' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });

    const written = await call('POST', `/api/profiles/${id}/storage`, {
      area: 'local',
      key: 'token',
      value: 'real-value',
    });
    assert.equal(written.status, 200);
    assert.equal(written.body.value, 'real-value');

    const read = await call('POST', `/api/profiles/${id}/storage`, { area: 'local', key: 'token' });
    assert.equal(read.body.value, 'real-value');

    const entries = await call('POST', `/api/profiles/${id}/storage`, { area: 'local' });
    assert.ok(entries.body.entries.some(([key, value]) => key === 'token' && value === 'real-value'));

    const frames = await call('GET', `/api/profiles/${id}/frames`);
    assert.ok(frames.body.frames.length >= 1);

    const shot = await fetch(`http://127.0.0.1:${port}/api/profiles/${id}/screenshot`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(shot.status, 200);
    assert.equal(shot.headers.get('content-type'), 'image/png');
    assert.ok((await shot.arrayBuffer()).byteLength > 0);
  } finally {
    await app.engine.closeAll();
    await new Promise((resolve) => app.server.close(resolve));
    app.storage.close();
    await site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('real browser: stored cookies are restored into the context after a reopen', { skip: hasBrowser ? false : 'chromium binary not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-e2e-cookie-'));
  const site = await startTestSite();
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
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const call = async (method, urlPath, body) => {
    const options = {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    };
    if (body !== undefined && method !== 'GET') options.body = JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    const created = await call('POST', '/api/profiles', { name: 'Cookies' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });

    const stored = await call('POST', `/api/profiles/${id}/cookies`, {
      cookies: [{ name: 'sid', domain: '127.0.0.1', path: '/', value: 'session-token' }],
    });
    assert.equal(stored.status, 200);

    await call('POST', `/api/profiles/${id}/close`);
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });

    const visible = await call('POST', `/api/profiles/${id}/evaluate`, {
      expression: 'document.cookie',
    });
    assert.equal(visible.status, 200);
    assert.match(visible.body.result, /sid=session-token/);
  } finally {
    await app.engine.closeAll();
    await new Promise((resolve) => app.server.close(resolve));
    app.storage.close();
    await site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('two profiles keep separate state', { skip: hasBrowser ? false : 'chromium binary not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-e2e-iso-'));
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
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const call = async (method, urlPath, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    const a = await call('POST', '/api/profiles', { name: 'Iso A' });
    const b = await call('POST', '/api/profiles', { name: 'Iso B' });

    await call('POST', `/api/profiles/${a.body.profile.id}/open`);
    await call('POST', `/api/profiles/${b.body.profile.id}/open`);

    await call('POST', `/api/profiles/${a.body.profile.id}/cookies`, {
      cookies: [{ name: 'only-a', domain: 'example.com', value: '1' }],
    });

    const cookiesB = await call('GET', `/api/profiles/${b.body.profile.id}/cookies`);
    assert.equal(cookiesB.body.cookies.length, 0);
  } finally {
    await app.engine.closeAll();
    await new Promise((resolve) => app.server.close(resolve));
    app.storage.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

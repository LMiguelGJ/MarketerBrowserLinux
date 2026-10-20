import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../../server.js';
import { startTestSite } from '../fixtures/site/server.js';

const TOKEN = 'e2e-lifecycle-token';

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
const skip = hasBrowser ? false : 'chromium binary not installed';

async function startRealApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbl-e2e-life-'));
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

  const cleanup = async () => {
    await app.close();
    app.storage.close();
    await site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { app, call, site, cleanup, dataDir };
}

test('real browser: closing the tab twice leaves the profile usable', { skip }, async () => {
  const { call, site, cleanup } = await startRealApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'Tabs' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });

    assert.equal((await call('POST', `/api/profiles/${id}/close-tab`)).status, 200);
    assert.equal((await call('POST', `/api/profiles/${id}/close-tab`)).status, 200);
    assert.equal((await call('GET', `/api/profiles/${id}/frames`)).status, 200);

    // After closing every tab the profile must still navigate and render.
    const navigated = await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });
    assert.equal(navigated.status, 200);

    const title = await call('POST', `/api/profiles/${id}/evaluate`, {
      expression: "document.getElementById('title').textContent",
    });
    assert.equal(title.body.result, 'MBL test site');
  } finally {
    await cleanup();
  }
});

test('real browser: reset-urls sends every tab back to the base url', { skip }, async () => {
  const { call, site, cleanup } = await startRealApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'Reset' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: `${site.url}?page=other` });

    const reset = await call('POST', `/api/profiles/${id}/reset-urls`, { url: site.url });
    assert.equal(reset.status, 200);
    assert.ok(reset.body.reset >= 1);

    const href = await call('POST', `/api/profiles/${id}/evaluate`, {
      expression: 'location.href',
    });
    assert.equal(href.body.result, site.url);
  } finally {
    await cleanup();
  }
});

test('real browser: deleting a running profile removes its data and leaves no session', { skip }, async () => {
  const { app, call, site, cleanup, dataDir } = await startRealApp();
  try {
    const created = await call('POST', '/api/profiles', { name: 'Doomed' });
    const id = created.body.profile.id;
    await call('POST', `/api/profiles/${id}/open`);
    await call('POST', `/api/profiles/${id}/navigate`, { url: site.url });

    const directory = path.join(dataDir, 'profiles', id);
    assert.equal(fs.existsSync(directory), true);

    const deleted = await call('DELETE', `/api/profiles/${id}`);
    assert.equal(deleted.status, 200);
    assert.equal(app.engine.isRunning(id), false);
    assert.equal(fs.existsSync(directory), false);
    assert.equal((await call('GET', `/api/profiles/${id}`)).status, 404);
  } finally {
    await cleanup();
  }
});

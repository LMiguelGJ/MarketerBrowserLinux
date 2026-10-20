import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProfileName, ValidationError, publicProfile } from '../../src/profiles.js';
import { validateProxy, proxyLabel, proxyUrl, parseProxyUrl, ProxyError } from '../../src/proxy.js';
import { validateCookie, validateCookieList, CookieError } from '../../src/cookies.js';
import { exportBundle, parseBundle, ImportError } from '../../src/import-export.js';

test('profile name accepts a normal name and trims it', () => {
  assert.equal(validateProfileName('  Cuenta Principal  '), 'Cuenta Principal');
});

test('profile name rejects empty, non-string and malformed values', () => {
  for (const bad of ['', '   ', 'con/slash', '-leading', 'a'.repeat(65), 42, null, undefined]) {
    assert.throws(() => validateProfileName(bad), ValidationError, `expected rejection for ${String(bad)}`);
  }
});

test('public profile never exposes the proxy url', () => {
  const row = {
    id: 'p1',
    name: 'A',
    status: 'stopped',
    engine: 'chromium',
    proxy_url: 'http://user:secret@proxy.local:8080',
    proxy_label: 'http://proxy.local:8080 (auth)',
    created_at: 'now',
    updated_at: 'now',
  };
  const view = publicProfile(row);
  assert.equal(view.proxy, 'http://proxy.local:8080 (auth)');
  assert.equal(JSON.stringify(view).includes('secret'), false);
});

test('proxy validation accepts supported schemes', () => {
  const proxy = validateProxy({ type: 'socks5', host: 'proxy.local', port: 1080 });
  assert.deepEqual(proxy, {
    type: 'socks5',
    host: 'proxy.local',
    port: 1080,
    username: null,
    password: null,
  });
});

test('proxy validation rejects unsupported schemes and bad ports', () => {
  assert.throws(() => validateProxy({ type: 'ftp', host: 'h', port: 21 }), ProxyError);
  assert.throws(() => validateProxy({ type: 'http', host: 'h', port: 0 }), ProxyError);
  assert.throws(() => validateProxy({ type: 'http', host: 'h', port: 70000 }), ProxyError);
  assert.throws(() => validateProxy({ type: 'http', host: '', port: 80 }), ProxyError);
  assert.throws(() => validateProxy({ type: 'http', host: 'bad host', port: 80 }), ProxyError);
});

test('proxy validation requires credentials as a pair', () => {
  assert.throws(
    () => validateProxy({ type: 'http', host: 'h', port: 80, username: 'u' }),
    ProxyError,
  );
});

test('proxy label and url handle credentials without leaking them into the label', () => {
  const proxy = validateProxy({
    type: 'http',
    host: 'proxy.local',
    port: 8080,
    username: 'user',
    password: 'secret',
  });
  assert.equal(proxyLabel(proxy), 'http://proxy.local:8080 (auth)');
  assert.equal(proxyUrl(proxy), 'http://user:secret@proxy.local:8080');
});

test('parse proxy url rejects malformed input with a validation error', () => {
  assert.throws(() => parseProxyUrl('not a url'), ProxyError);
  assert.equal(parseProxyUrl(null), null);
});

test('cookie validation applies defaults and rejects malformed records', () => {
  const cookie = validateCookie({ name: 'a', domain: 'example.com', value: '1' });
  assert.deepEqual(cookie, {
    name: 'a',
    domain: 'example.com',
    path: '/',
    value: '1',
    expires: null,
    secure: false,
    httpOnly: false,
  });

  assert.throws(() => validateCookie({ name: 'a b', domain: 'example.com', value: '1' }), CookieError);
  assert.throws(() => validateCookie({ name: 'a', domain: 'example.com' }), CookieError);
  assert.throws(() => validateCookie({ name: 'a', domain: 'example.com', value: '1', path: 'x' }), CookieError);
  assert.throws(() => validateCookieList('nope'), CookieError);
});

test('export produces a versioned bundle and parse rejects foreign formats', () => {
  const bundle = exportBundle({
    profile: { name: 'A', engine: 'chromium' },
    cookies: [{ name: 'a', domain: 'example.com', path: '/', value: '1' }],
    proxy: null,
  });
  assert.equal(bundle.format, 'mbl-linux-native-profile');
  assert.equal(bundle.version, 1);

  const parsed = parseBundle(bundle);
  assert.equal(parsed.name, 'A');
  assert.equal(parsed.cookies.length, 1);

  assert.throws(() => parseBundle({ ...bundle, format: 'other' }), ImportError);
  assert.throws(() => parseBundle({ ...bundle, version: 99 }), ImportError);
  assert.throws(() => parseBundle({ ...bundle, cookies: [{ bad: true }] }), ImportError);
});

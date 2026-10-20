import fs from 'node:fs';
import path from 'node:path';

const PROXY_TYPES = new Set(['http', 'https', 'socks4', 'socks5']);
const HOST_PATTERN = /^[A-Za-z0-9._-]+$/;

export class ProxyError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ProxyError';
    this.field = field;
    this.status = 400;
  }
}

/**
 * Validate a proxy definition. Only the schemes the browser engine can
 * actually apply are accepted; anything else is rejected explicitly instead
 * of being stored and silently ignored.
 */
export function validateProxy(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'object') throw new ProxyError('proxy must be an object', 'proxy');

  const type = String(raw.type ?? '').toLowerCase();
  if (!PROXY_TYPES.has(type)) {
    throw new ProxyError(
      `proxy.type must be one of ${[...PROXY_TYPES].join(', ')} (received "${raw.type ?? ''}")`,
      'proxy.type',
    );
  }

  const host = String(raw.host ?? '').trim();
  if (host.length === 0) throw new ProxyError('proxy.host is required', 'proxy.host');
  if (!HOST_PATTERN.test(host)) throw new ProxyError('proxy.host has invalid characters', 'proxy.host');

  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxyError('proxy.port must be an integer between 1 and 65535', 'proxy.port');
  }

  const username = raw.username === undefined || raw.username === null ? null : String(raw.username);
  const password = raw.password === undefined || raw.password === null ? null : String(raw.password);
  if ((username === null) !== (password === null)) {
    throw new ProxyError('proxy.username and proxy.password must be provided together', 'proxy');
  }

  return { type, host, port, username, password };
}

/** Build the URL handed to the browser engine. Credentials never reach logs. */
export function proxyUrl(proxy) {
  if (!proxy) return null;
  const credentials =
    proxy.username === null
      ? ''
      : `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
  return `${proxy.type}://${credentials}${proxy.host}:${proxy.port}`;
}

/** Human-readable label with credentials omitted, safe for API responses and logs. */
export function proxyLabel(proxy) {
  if (!proxy) return null;
  const auth = proxy.username === null ? '' : ' (auth)';
  return `${proxy.type}://${proxy.host}:${proxy.port}${auth}`;
}

export function parseProxyUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProxyError('proxy url is malformed', 'proxy');
  }
  return validateProxy({
    type: url.protocol.replace(':', ''),
    host: url.hostname,
    port: Number(url.port),
    username: url.username || null,
    password: url.password || null,
  });
}

export function writeProxyFile(file, proxy) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, proxy ? proxyUrl(proxy) : '', { mode: 0o600 });
}

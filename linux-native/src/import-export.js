import { validateCookieList, CookieError } from './cookies.js';
import { validateProxy, ProxyError } from './proxy.js';

export const BUNDLE_VERSION = 1;

export class ImportError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ImportError';
    this.field = field;
    this.status = 400;
  }
}

/**
 * Export a profile bundle. The format is ours and versioned; it does not claim
 * compatibility with the original application's private format.
 */
export function exportBundle({ profile, cookies, proxy }) {
  return {
    format: 'mbl-linux-native-profile',
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    profile: {
      name: profile.name,
      engine: profile.engine ?? null,
    },
    proxy: proxy ? { type: proxy.type, host: proxy.host, port: proxy.port } : null,
    cookies,
  };
}

/**
 * Validate an imported bundle before anything is written. Returns a normalized
 * object; the caller applies it only after validation succeeds, so a rejected
 * import leaves stored data untouched.
 */
export function parseBundle(raw) {
  if (raw === null || typeof raw !== 'object') {
    throw new ImportError('bundle must be an object', 'bundle');
  }
  if (raw.format !== 'mbl-linux-native-profile') {
    throw new ImportError('unsupported bundle format', 'format');
  }
  if (raw.version !== BUNDLE_VERSION) {
    throw new ImportError(`unsupported bundle version: ${raw.version}`, 'version');
  }
  if (raw.profile === null || typeof raw.profile !== 'object') {
    throw new ImportError('bundle.profile is required', 'profile');
  }
  if (typeof raw.profile.name !== 'string' || raw.profile.name.trim().length === 0) {
    throw new ImportError('bundle.profile.name is required', 'profile.name');
  }

  let proxy = null;
  if (raw.proxy !== null && raw.proxy !== undefined) {
    try {
      proxy = validateProxy(raw.proxy);
    } catch (error) {
      if (error instanceof ProxyError) throw new ImportError(error.message, error.field);
      throw new ImportError('bundle.proxy is invalid', 'proxy');
    }
  }

  let cookies;
  try {
    cookies = validateCookieList(raw.cookies ?? []);
  } catch (error) {
    if (error instanceof CookieError) throw new ImportError(error.message, error.field);
    throw new ImportError('bundle.cookies is invalid', 'cookies');
  }

  return {
    name: raw.profile.name.trim(),
    engine: typeof raw.profile.engine === 'string' ? raw.profile.engine : null,
    proxy,
    cookies,
  };
}

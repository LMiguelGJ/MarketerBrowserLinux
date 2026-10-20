import path from 'node:path';

function intEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${raw}`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.MBL_DATA_DIR || path.join(process.cwd(), 'data'));
  const authToken = env.MBL_AUTH_TOKEN || '';
  const host = env.MBL_HOST || '127.0.0.1';
  const requireAuth = env.MBL_REQUIRE_AUTH !== 'false';

  // An open service on a routable interface would expose browser control to
  // the network. Disabling authentication is only allowed on loopback.
  if (!requireAuth && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `Refusing to start without authentication on a non-loopback host: ${host}. ` +
        'Set MBL_REQUIRE_AUTH=true, or bind to 127.0.0.1.',
    );
  }

  return {
    host,
    port: intEnv(env, 'MBL_PORT', 3000),
    dataDir,
    profilesDir: path.join(dataDir, 'profiles'),
    dbFile: path.join(dataDir, 'mbl.sqlite'),
    authToken,
    // Engine selection is explicit so the lab can run without a browser binary.
    engine: env.MBL_ENGINE || 'chromium',
    headless: env.MBL_HEADLESS !== 'false',
    // The browser sandbox stays on unless the environment cannot provide it.
    sandbox: env.MBL_BROWSER_SANDBOX !== 'false',
    // Cookies are marked Secure only when the service is served over TLS.
    secureCookies: env.MBL_SECURE_COOKIES === 'true',
    maxProfiles: intEnv(env, 'MBL_MAX_PROFILES', 2),
    frameIntervalMs: intEnv(env, 'MBL_FRAME_INTERVAL_MS', 400),
    requireAuth,
  };
}

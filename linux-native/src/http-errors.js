import { ValidationError } from './profiles.js';
import { CookieError } from './cookies.js';
import { ProxyError } from './proxy.js';
import { ImportError } from './import-export.js';

export function errorStatus(error) {
  if (typeof error?.status === 'number') return error.status;
  if (
    error instanceof ValidationError ||
    error instanceof CookieError ||
    error instanceof ProxyError ||
    error instanceof ImportError
  ) {
    return 400;
  }
  return 500;
}

export function errorBody(error) {
  const status = errorStatus(error);
  const body = { error: status === 500 ? 'internal error' : error.message };
  if (status !== 500 && error.field) body.field = error.field;
  return { status, body };
}

export function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

export function sendError(res, error) {
  const { status, body } = errorBody(error);
  sendJson(res, status, body);
}

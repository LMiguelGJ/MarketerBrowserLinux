import { randomUUID } from 'node:crypto';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.status = 400;
  }
}

export function validateProfileName(raw) {
  if (typeof raw !== 'string') throw new ValidationError('name must be a string', 'name');
  const name = raw.trim();
  if (name.length === 0) throw new ValidationError('name must not be empty', 'name');
  if (!NAME_PATTERN.test(name)) {
    throw new ValidationError(
      'name must start alphanumeric and may contain spaces, dots, dashes and underscores (max 64 chars)',
      'name',
    );
  }
  return name;
}

export function newProfileId() {
  return randomUUID();
}

/**
 * Decode and validate a profile identifier coming from a URL.
 *
 * A malformed percent-encoding must become a 400, not an uncaught URIError,
 * and the identifier must never be able to escape the profile directory.
 */
export function decodeProfileId(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new ValidationError('profile id is malformed', 'id');
  }
  if (!ID_PATTERN.test(decoded)) {
    throw new ValidationError('profile id is malformed', 'id');
  }
  return decoded;
}

export function nowIso(date = new Date()) {
  return date.toISOString();
}

export function publicProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    engine: row.engine,
    proxy: row.proxy_label ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

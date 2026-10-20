import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',
  proxy_url TEXT,
  proxy_label TEXT,
  engine TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cookies (
  profile_id TEXT NOT NULL,
  cookie_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  path TEXT NOT NULL,
  value TEXT NOT NULL,
  expires INTEGER,
  secure INTEGER NOT NULL DEFAULT 0,
  http_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, cookie_name, domain, path),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

export class Storage {
  constructor(dbFile) {
    this.dbFile = dbFile;
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    // A restart leaves no browser running, so any profile still marked as
    // running is stale and must not be reported as active.
    this.db.prepare("UPDATE profiles SET status = 'stopped' WHERE status = 'running'").run();
  }

  close() {
    this.db.close();
  }

  createProfile({ id, name, engine, proxyUrl = null, proxyLabel = null, now }) {
    this.db
      .prepare(
        `INSERT INTO profiles (id, name, status, proxy_url, proxy_label, engine, created_at, updated_at)
         VALUES (?, ?, 'stopped', ?, ?, ?, ?, ?)`,
      )
      .run(id, name, proxyUrl, proxyLabel, engine, now, now);
    return this.getProfile(id);
  }

  /**
   * Create a profile together with its cookies in one transaction. If any
   * step fails nothing is stored, so an import never leaves a half-created
   * profile behind.
   */
  importProfile({ id, name, engine, proxyUrl = null, proxyLabel = null, cookies, now }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO profiles (id, name, status, proxy_url, proxy_label, engine, created_at, updated_at)
           VALUES (?, ?, 'stopped', ?, ?, ?, ?, ?)`,
        )
        .run(id, name, proxyUrl, proxyLabel, engine, now, now);
      const insert = this.db.prepare(
        `INSERT INTO cookies (profile_id, cookie_name, domain, path, value, expires, secure, http_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const cookie of cookies) {
        insert.run(
          id,
          cookie.name,
          cookie.domain,
          cookie.path,
          cookie.value,
          cookie.expires ?? null,
          cookie.secure ? 1 : 0,
          cookie.httpOnly ? 1 : 0,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getProfile(id);
  }

  getProfile(id) {
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) ?? null;
  }

  listProfiles() {
    return this.db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all();
  }

  countProfiles() {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get();
    return row.n;
  }

  updateProfile(id, fields) {
    const allowed = ['name', 'status', 'proxy_url', 'proxy_label', 'engine', 'updated_at'];
    const keys = Object.keys(fields).filter((key) => allowed.includes(key));
    if (keys.length === 0) return this.getProfile(id);
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    this.db.prepare(`UPDATE profiles SET ${assignments} WHERE id = ?`).run(...values, id);
    return this.getProfile(id);
  }

  deleteProfile(id) {
    const info = this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM cookies WHERE profile_id = ?').run(id);
    return info.changes > 0;
  }

  listCookies(profileId) {
    return this.db
      .prepare(
        `SELECT cookie_name AS name, domain, path, value, expires, secure, http_only AS httpOnly
         FROM cookies WHERE profile_id = ? ORDER BY domain, path, cookie_name`,
      )
      .all(profileId);
  }

  /**
   * Replace the cookies of a profile atomically. Either every cookie is
   * written or none is: a failure rolls back and leaves the previous set
   * untouched.
   */
  replaceCookies(profileId, cookies) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM cookies WHERE profile_id = ?').run(profileId);
      const insert = this.db.prepare(
        `INSERT INTO cookies (profile_id, cookie_name, domain, path, value, expires, secure, http_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const cookie of cookies) {
        insert.run(
          profileId,
          cookie.name,
          cookie.domain,
          cookie.path,
          cookie.value,
          cookie.expires ?? null,
          cookie.secure ? 1 : 0,
          cookie.httpOnly ? 1 : 0,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listCookies(profileId);
  }

  audit(profileId, action, detail, now) {
    this.db
      .prepare('INSERT INTO audit_log (profile_id, action, detail, created_at) VALUES (?, ?, ?, ?)')
      .run(profileId ?? null, action, detail ?? null, now);
  }

  auditEntries(profileId) {
    return this.db
      .prepare('SELECT * FROM audit_log WHERE profile_id = ? ORDER BY id ASC')
      .all(profileId);
  }
}

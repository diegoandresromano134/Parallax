import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.PRODE_DB || resolve(here, '../data/prode.db');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL, pin_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE, name TEXT NOT NULL, country TEXT,
  season TEXT, enabled INTEGER NOT NULL DEFAULT 0, synced_at TEXT);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  ext_id TEXT UNIQUE, round TEXT, home TEXT NOT NULL, away TEXT NOT NULL,
  home_badge TEXT, away_badge TEXT, kickoff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|finished|postponed|cancelled
  home_goals INTEGER, away_goals INTEGER, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS matches_kickoff ON matches(kickoff);
CREATE TABLE IF NOT EXISTS predictions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home INTEGER NOT NULL, away INTEGER NOT NULL, points INTEGER,
  PRIMARY KEY (user_id, match_id));
CREATE TABLE IF NOT EXISTS bets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pick TEXT NOT NULL CHECK (pick IN ('L','E','V')), stake INTEGER NOT NULL, payout INTEGER,
  PRIMARY KEY (user_id, match_id));
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getSetting = (k) => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v;
export const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

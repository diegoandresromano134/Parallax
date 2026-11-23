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
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  birth_date TEXT NOT NULL, fav_team TEXT, avatar TEXT, color TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT, owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL, joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, group_id));
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE, name TEXT NOT NULL, country TEXT,
  season TEXT, enabled INTEGER NOT NULL DEFAULT 0, synced_at TEXT, standings_json TEXT);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  ext_id TEXT UNIQUE, round TEXT, home TEXT NOT NULL, away TEXT NOT NULL,
  home_badge TEXT, away_badge TEXT, kickoff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|finished|postponed|cancelled
  home_goals INTEGER, away_goals INTEGER, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS matches_kickoff ON matches(kickoff);
-- El juego es por grupo: cada grupo tiene sus fichas, su pozo y su ranking.
CREATE TABLE IF NOT EXISTS predictions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home INTEGER NOT NULL, away INTEGER NOT NULL, points INTEGER,
  PRIMARY KEY (user_id, group_id, match_id));
CREATE TABLE IF NOT EXISTS bets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pick TEXT NOT NULL CHECK (pick IN ('L','E','V')), stake INTEGER NOT NULL, payout INTEGER,
  PRIMARY KEY (user_id, group_id, match_id));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS comments_match ON comments(group_id, match_id);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS push_queue (
  id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  pinged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS coin_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  granted INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS coin_log (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS notified (
  user_id INTEGER NOT NULL, match_id INTEGER NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY (user_id, match_id, kind));
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getSetting = (k) => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v;
export const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

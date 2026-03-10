-- SQLite schema (reference only — schema is auto-initialized in db/index.js)

CREATE TABLE IF NOT EXISTS dm (
  id INTEGER PRIMARY KEY,
  battlefield TEXT NOT NULL DEFAULT '[]',
  treasures TEXT NOT NULL DEFAULT '[]',
  shops TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  character_hp TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT '',
  species TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1,
  background TEXT NOT NULL DEFAULT '',
  hp INTEGER NOT NULL DEFAULT 10,
  ac INTEGER NOT NULL DEFAULT 10,
  str INTEGER NOT NULL DEFAULT 10,
  dex INTEGER NOT NULL DEFAULT 10,
  con INTEGER NOT NULL DEFAULT 10,
  int INTEGER NOT NULL DEFAULT 10,
  wis INTEGER NOT NULL DEFAULT 10,
  cha INTEGER NOT NULL DEFAULT 10,
  skills TEXT NOT NULL DEFAULT '[]',
  features TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT '{"CP":0,"SP":0,"EP":0,"GP":0,"PP":0}',
  equipment TEXT NOT NULL DEFAULT '[]',
  spells TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY,
  pin TEXT NOT NULL,
  characters TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

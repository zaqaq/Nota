import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      text TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      trace TEXT,
      refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES notes(id),
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES notes(id),
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS notes_user_created ON notes(user_id, created_at);
  `);
  const columns = db.prepare(`PRAGMA table_info(notes)`).all();
  if (!columns.some((column) => column.name === "messages")) {
    db.exec(`ALTER TABLE notes ADD COLUMN messages TEXT`);
  }
  return db;
}

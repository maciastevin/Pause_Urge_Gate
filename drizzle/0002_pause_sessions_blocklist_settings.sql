DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  trigger_text TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE blocklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  pause_minutes INTEGER NOT NULL DEFAULT 5,
  custom_affirmation TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
INSERT INTO settings (id, pause_minutes, custom_affirmation) VALUES (1, 5, '');

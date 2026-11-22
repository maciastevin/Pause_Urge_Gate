ALTER TABLE settings ADD COLUMN escalation_enabled INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN emergency_exit_url TEXT NOT NULL DEFAULT 'https://www.google.com';

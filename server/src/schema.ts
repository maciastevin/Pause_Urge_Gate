import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull(), // breathe | affirmation | challenge | cats | none
  triggerText: text("trigger_text").notNull().default(""),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const blocklist = sqliteTable("blocklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  domain: text("domain").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  pauseMinutes: integer("pause_minutes").notNull().default(5),
  customAffirmation: text("custom_affirmation").notNull().default(""),
  escalationEnabled: integer("escalation_enabled", { mode: "boolean" }).notNull().default(true),
  emergencyExitUrl: text("emergency_exit_url").notNull().default("https://www.google.com"),
});

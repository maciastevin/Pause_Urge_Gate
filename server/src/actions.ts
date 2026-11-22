import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const sessionShape = z.object({
  id: z.number(),
  path: z.string(),
  triggerText: z.string(),
  completed: z.boolean(),
  created_at: z.string(),
});

// Escalation ("fall timer"): a pause that starts within this window of the
// previous pause's end counts as a quick return and doubles the next timer.
const QUICK_RETURN_WINDOW_MS = 30 * 60 * 1000;
// Hard ceiling on any single pause, however many quick returns stack up.
const MAX_PAUSE_MINUTES = 60;

export const Actions = {
  getState: defineAction({
    description: "Returns settings, blocklist, recent sessions and lifetime stats.",
    request: z.object({}),
    response: z.object({
      pauseMinutes: z.number(),
      customAffirmation: z.string(),
      escalationEnabled: z.boolean(),
      emergencyExitUrl: z.string(),
      escalationLevel: z.number(),
      escalationMultiplier: z.number(),
      effectivePauseMinutes: z.number(),
      lastPauseAt: z.string().nullable(),
      blocklist: z.array(z.object({ id: z.number(), domain: z.string() })),
      sessions: z.array(sessionShape),
      totalPauses: z.number(),
      completedPauses: z.number(),
      streakDays: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const sRows = await db.select().from(schema.settings).limit(1);
      const s = sRows[0];
      const bl = await db.select().from(schema.blocklist).orderBy(desc(schema.blocklist.id)).limit(100);
      const sess = await db.select().from(schema.sessions).orderBy(desc(schema.sessions.id)).limit(50);
      const completed = sess.filter((r) => r.completed).length;
      // streak: consecutive days (viewer-agnostic, UTC days) with a completed pause, ending today or yesterday
      const days = new Set(
        sess.filter((r) => r.completed).map((r) => r.createdAt.toISOString().slice(0, 10)),
      );
      let streak = 0;
      const cursor = new Date();
      // if today has none yet, start from yesterday so streak doesn't look broken in the morning
      if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
      while (days.has(cursor.toISOString().slice(0, 10))) {
        streak++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      // Escalation level: length of the unbroken chain of pauses (newest
      // first) where each started within QUICK_RETURN_WINDOW_MS of the
      // previous one's end. If the most recent pause is already older than
      // the window, the chain is broken and the level is 0.
      const baseMinutes = s?.pauseMinutes ?? 5;
      const escalationEnabled = s?.escalationEnabled ?? true;
      let escalationLevel = 0;
      if (escalationEnabled && sess.length > 0) {
        const byTime = [...sess].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        let prev = Date.now();
        for (const row of byTime) {
          if (prev - row.createdAt.getTime() <= QUICK_RETURN_WINDOW_MS) {
            escalationLevel++;
            prev = row.createdAt.getTime();
          } else {
            break;
          }
        }
      }
      const escalationMultiplier = 2 ** escalationLevel;
      const effectivePauseMinutes = Math.min(baseMinutes * escalationMultiplier, MAX_PAUSE_MINUTES);
      const lastRow = sess.reduce<(typeof sess)[number] | null>(
        (acc, r) => (acc === null || r.createdAt > acc.createdAt ? r : acc),
        null,
      );
      return {
        pauseMinutes: baseMinutes,
        customAffirmation: s?.customAffirmation ?? "",
        escalationEnabled,
        emergencyExitUrl: s?.emergencyExitUrl ?? "https://www.google.com",
        escalationLevel,
        escalationMultiplier,
        effectivePauseMinutes,
        lastPauseAt: lastRow ? lastRow.createdAt.toISOString() : null,
        blocklist: bl.map((r) => ({ id: r.id, domain: r.domain })),
        sessions: sess.map((r) => ({
          id: r.id,
          path: r.path,
          triggerText: r.triggerText,
          completed: r.completed,
          created_at: r.createdAt.toISOString(),
        })),
        totalPauses: sess.length,
        completedPauses: completed,
        streakDays: streak,
      };
    },
  }),

  logSession: defineAction({
    description: "Logs one pause session when an intervention finishes or is exited.",
    request: z.object({
      path: z.enum(["breathe", "affirmation", "challenge", "cats", "none"]),
      triggerText: z.string().max(200).default(""),
      completed: z.boolean(),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.sessions)
        .values({ path: args.path, triggerText: args.triggerText, completed: args.completed })
        .returning({ id: schema.sessions.id });
      const inserted = result[0];
      if (!inserted) throw new Error("logSession: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateSettings: defineAction({
    description: "Updates pause length, custom affirmation, quick-return escalation, and the emergency exit destination.",
    request: z.object({
      pauseMinutes: z.number().int().min(1).max(15),
      customAffirmation: z.string().max(300).default(""),
      escalationEnabled: z.boolean().default(true),
      emergencyExitUrl: z.string().trim().max(500).default("https://www.google.com"),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const exitUrl = /^https?:\/\//i.test(args.emergencyExitUrl)
        ? args.emergencyExitUrl
        : "https://www.google.com";
      const values = {
        pauseMinutes: args.pauseMinutes,
        customAffirmation: args.customAffirmation,
        escalationEnabled: args.escalationEnabled,
        emergencyExitUrl: exitUrl,
      };
      const existing = await db.select().from(schema.settings).limit(1);
      if (existing[0]) {
        await db
          .update(schema.settings)
          .set(values)
          .where(eq(schema.settings.id, existing[0].id));
      } else {
        await db.insert(schema.settings).values({ id: 1, ...values });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addBlockDomain: defineAction({
    description: "Adds a domain or keyword to the user's watch list.",
    request: z.object({ domain: z.string().trim().min(1).max(120) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const clean = args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const result = await db
        .insert(schema.blocklist)
        .values({ domain: clean })
        .returning({ id: schema.blocklist.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addBlockDomain: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  removeBlockDomain: defineAction({
    description: "Removes a domain from the watch list.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.blocklist).where(eq(schema.blocklist.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;

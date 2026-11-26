import { z } from "zod";
import type { ContextToolCall, ResponsesTool } from "@/lib/openai/responsesClient";

/**
 * The tools the Guide uses to answer questions about the user's notifications and to change them
 * when asked (push-engagement-plan.md §7.3). The settings and the record of what was shown live on
 * the user's phone, so `get_notification_settings` is answered there, and a change is checked here
 * and handed back as a `notification_settings` event for the app to apply. Nothing is stored here.
 */

export const GET_NOTIFICATION_SETTINGS = "get_notification_settings";
export const NOTIFICATION_TOOL_NAMES: ReadonlySet<string> = new Set(["update_notification_settings"]);

/** Which days a heads-up time is for. */
const DAYS = ["all", "weekdays", "weekends"] as const;

/** A pause longer than this, or turning everything off, is confirmed with the user first. */
export const PAUSE_WITHOUT_ASKING_DAYS = 14;

export type NotificationSettingsEvent = {
  headsUp?: boolean;
  time?: { mode: "auto"; days: (typeof DAYS)[number] } | { mode: "chosen"; at: string; days: (typeof DAYS)[number] };
  reflectReminders?: boolean;
  goalNotifications?: { goalId: string; on: boolean };
  /** yyyy-MM-dd: the day notifications start again. */
  pausedUntil?: string;
  /** Ends a pause now. */
  resume?: true;
};

export type NotificationToolResult = { output: string; event?: NotificationSettingsEvent };

const isRealDate = (value: string): boolean => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
};

/**
 * One change per call, named. The model fills every field it is offered, with the current value
 * or a placeholder, so a call that could change several things at once changed things nobody asked
 * for. A named change reads only the fields it needs and ignores the rest.
 */
const CHANGES = [
  "heads_up_on",
  "heads_up_off",
  "heads_up_time",
  "heads_up_usual_time",
  "reflect_reminders_on",
  "reflect_reminders_off",
  "goal_notifications_on",
  "goal_notifications_off",
  "pause",
  "end_pause",
  "all_off",
] as const;

const updateSchema = z.object({
  change: z.enum(CHANGES),
  at: z.string().nullish(),
  days: z.enum(DAYS).nullish(),
  goalId: z.string().trim().max(128).nullish(),
  until: z.string().nullish(),
  confirmed: z.boolean().nullish(),
});

const clockText = /^([01]\d|2[0-3]):[0-5]\d$/;

const refuse = (reason: string): NotificationToolResult => ({ output: JSON.stringify({ ok: false, reason }) });

const accept = (event: NotificationSettingsEvent): NotificationToolResult => ({ output: JSON.stringify({ ok: true }), event });

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Answers `update_notification_settings` for one request. `goalIds` are the goals the app told us about. */
export function createNotificationToolRunner(args: {
  goalIds: string[];
  today: string;
}): (call: ContextToolCall) => NotificationToolResult {
  return (call) => {
    if (call.name !== "update_notification_settings") return refuse("unknown_tool");
    let raw: unknown;
    try {
      raw = JSON.parse(call.argumentsJson);
    } catch {
      return refuse("invalid_arguments: not valid JSON");
    }
    // A field left empty says nothing.
    const given = raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== ""))
      : raw;
    const parsed = updateSchema.safeParse(given);
    if (!parsed.success) {
      return refuse(`invalid_arguments: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "arguments"))].join(", ")}`);
    }
    const input = parsed.data;
    const days = input.days ?? "all";

    switch (input.change) {
      case "heads_up_on":
      case "heads_up_off":
        return accept({ headsUp: input.change === "heads_up_on" });
      case "heads_up_time":
        if (!input.at || !clockText.test(input.at)) return refuse("invalid_arguments: at");
        return accept({ time: { mode: "chosen", at: input.at, days } });
      case "heads_up_usual_time":
        return accept({ time: { mode: "auto", days } });
      case "reflect_reminders_on":
      case "reflect_reminders_off":
        return accept({ reflectReminders: input.change === "reflect_reminders_on" });
      case "goal_notifications_on":
      case "goal_notifications_off":
        if (!input.goalId || !args.goalIds.includes(input.goalId)) return refuse("unknown_goal");
        return accept({ goalNotifications: { goalId: input.goalId, on: input.change === "goal_notifications_on" } });
      case "pause": {
        if (!input.until || !isDay(input.until)) return refuse("invalid_arguments: until");
        if (input.until <= args.today) return refuse("pause_must_end_after_today");
        // A pause longer than two weeks is asked about once first (§7.3).
        if (daysBetween(args.today, input.until) > PAUSE_WITHOUT_ASKING_DAYS && input.confirmed !== true) return refuse("confirm_first");
        return accept({ pausedUntil: input.until });
      }
      case "end_pause":
        return accept({ resume: true });
      case "all_off":
        // Turning everything off is asked about once first (§7.3).
        if (input.confirmed !== true) return refuse("confirm_first");
        return accept({ headsUp: false, reflectReminders: false });
    }
  };
}

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && isRealDate(value);

export const buildNotificationTools = (): ResponsesTool[] => [
  {
    type: "function",
    name: GET_NOTIFICATION_SETTINGS,
    description:
      "Get the user's notification settings and what was recently shown to them: whether the daily heads-up is on and when it comes (their usual time or a time they chose), when the next one is due, reminders to reflect, any pause, each goal's notification switch, whether this phone allows notifications from the app at all, and the last notifications actually shown (what each said, what kind it was, when, and whether it was opened). Call it before answering anything about their notifications.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "update_notification_settings",
    description:
      "Make one change to the user's notifications because they asked. One change per call; for two changes, call it twice. Nothing is stored here; the app applies it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["change"],
      properties: {
        change: {
          type: "string",
          enum: [...CHANGES],
          description:
            "heads_up_on / heads_up_off: the daily heads-up. heads_up_time: send it at a time they chose (at, and days if they named weekdays or weekends). heads_up_usual_time: back to a little before they usually open the app (days if they named weekdays or weekends). reflect_reminders_on / reflect_reminders_off: reminders to reflect after a reading, for all goals. goal_notifications_on / goal_notifications_off: one goal's notifications (goalId); you keep posting in its thread either way. pause: nothing until a day (until). end_pause: end a pause now. all_off: the heads-up and reminders both off (confirmed).",
        },
        at: { type: "string", description: "heads_up_time only: HH:mm, local time." },
        days: { type: "string", enum: [...DAYS], description: "heads_up_time and heads_up_usual_time only: all unless they named weekdays or weekends." },
        goalId: { type: "string", description: "goal_notifications_on and goal_notifications_off only: the id of the goal, from the goals list." },
        until: {
          type: "string",
          description: "pause only: yyyy-MM-dd, the day notifications start again, counted from today's date in <goals>.",
        },
        confirmed: {
          type: "boolean",
          description: `all_off, and a pause longer than ${PAUSE_WITHOUT_ASKING_DAYS} days: true only when the user has just said yes to it.`,
        },
      },
    },
  },
];

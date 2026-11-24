import { z } from "zod";
import type { ContextGoal } from "@/lib/chat/chatContextBundle";
import { looksInstructional, looksSensitive } from "@/lib/chat/tools/contextTools";
import { ACTIVITY_REGISTRY, ACTIVITY_TYPES, activityDefinition } from "@/lib/heartbeat/activityRegistry";
import { activityId, daysBetween, expiryFor } from "@/lib/heartbeat/rules";
import { clock, day, type Activity } from "@/lib/heartbeat/schemas";
import type { ContextToolCall, ResponsesTool } from "@/lib/openai/responsesClient";

/**
 * The tool the Guide uses to put something on the calendar, so a promise made in conversation
 * ("I'll check in with you tomorrow") is a real activity and not just words. Activities live in the
 * user's own encrypted records, so nothing is stored here: the call is checked and handed back as an
 * `activity` event for the app to apply. The heartbeat writes the message when the day comes.
 */

export const ACTIVITY_TOOL_NAMES: ReadonlySet<string> = new Set(["schedule_activity"]);

export type ActivityEvent = { action: "schedule"; activity: Activity };
export type ActivityToolResult = { output: string; event?: ActivityEvent };

/** The furthest ahead a promise may be scheduled. */
const MAX_DAYS_AHEAD = 14;
const MAX_PER_REQUEST = 3;

const scheduleSchema = z.object({
  goalId: z.string().trim().min(1).max(128),
  type: z.enum(ACTIVITY_TYPES),
  date: day,
  time: clock.nullish(),
  note: z
    .string()
    .trim()
    .max(160)
    .nullish()
    .transform((v) => (v ? v : undefined)),
});

/** The types that can be put on the calendar. The rest are posted only by a beat that finds its own proof. */
const SCHEDULABLE_TYPES = ACTIVITY_TYPES.filter((t) => ACTIVITY_REGISTRY[t].plannable);

const refuse = (reason: string): ActivityToolResult => ({ output: JSON.stringify({ ok: false, reason }) });

/**
 * Answers the activity tool for one request. `goalIds` are the goals the app has told us about
 * (the goal list and the goal thread's own goal), `goals` the details of those that were listed.
 */
export function createActivityToolRunner(args: {
  goalIds: string[];
  goals: ContextGoal[] | undefined;
  today: string;
}): (call: ContextToolCall) => ActivityToolResult {
  const scheduled = new Set<string>();

  return (call) => {
    if (call.name !== "schedule_activity") return refuse("unknown_tool");
    let raw: unknown;
    try {
      raw = JSON.parse(call.argumentsJson);
    } catch {
      return refuse("invalid_arguments: not valid JSON");
    }
    const parsed = scheduleSchema.safeParse(raw);
    if (!parsed.success) {
      return refuse(`invalid_arguments: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "arguments"))].join(", ")}`);
    }
    const input = parsed.data;

    if (!args.goalIds.includes(input.goalId)) return refuse("unknown_goal");
    const shape = args.goals?.find((g) => g.id === input.goalId)?.shape;
    if (!activityDefinition(input.type)?.plannable) return refuse("type_not_schedulable");
    if (shape && !activityDefinition(input.type)?.serves.includes(shape)) return refuse("type_not_for_goal");
    if (input.date < args.today) return refuse("date_in_the_past");
    if (daysBetween(args.today, input.date) > MAX_DAYS_AHEAD) return refuse("too_far_ahead");
    if (input.note && (looksSensitive(input.note) || looksInstructional(input.note))) return refuse("note_not_allowed");

    const id = activityId(input.goalId, input.type, input.date);
    if (scheduled.has(id)) return refuse("already_scheduled");
    if (scheduled.size >= MAX_PER_REQUEST) return refuse("too_many");
    scheduled.add(id);

    // The server does not know the user's timezone here, so expiry is worked out in UTC. The app may recompute it.
    const activity: Activity = {
      id,
      goalId: input.goalId,
      type: input.type,
      status: "planned",
      scheduledFor: input.date,
      ...(input.time ? { scheduledTime: input.time } : {}),
      expiresAt: expiryFor(input.type, input.date, "UTC"),
      ...(input.note ? { note: input.note } : {}),
    };
    return { output: JSON.stringify({ ok: true }), event: { action: "schedule", activity } };
  };
}

export const buildActivityTools = (): ResponsesTool[] => [
  {
    type: "function",
    name: "schedule_activity",
    description:
      "Put something on the user's calendar for one of their goals, so that what you promised really happens. Call it in the same turn that you tell the user you will check in with them, or send them a reading, a prayer or a question, later. Never promise that without calling this. Nothing is stored here; the app keeps it, and you write the message itself on the day.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["goalId", "type", "date"],
      properties: {
        goalId: { type: "string", description: "The id of the goal, from the goals list." },
        type: {
          type: "string",
          enum: [...SCHEDULABLE_TYPES],
          description: SCHEDULABLE_TYPES.map((t) => `${t}: serves ${ACTIVITY_REGISTRY[t].serves.join(", ")} goals`).join(". "),
        },
        date: { type: "string", description: `yyyy-MM-dd, from today's date in the goals list, at most ${MAX_DAYS_AHEAD} days ahead.` },
        time: { type: "string", description: "HH:mm, the local time, only if the user named one." },
        note: { type: "string", maxLength: 160, description: "What it is for, in a short factual line (for a check-in: what you will ask about)." },
      },
    },
  },
];


// Runs without a database or network: the notification tools only check what the model sends.
import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIENT_TOOL_NAMES } from "@/lib/chat/tools/contextTools";
import { NOTIFICATION_TOOL_NAMES, buildNotificationTools, createNotificationToolRunner } from "./notificationTools";

const today = "2026-11-25";

const run = (args: object) =>
  createNotificationToolRunner({ goalIds: ["g1"], today })({
    callId: "c1",
    name: "update_notification_settings",
    argumentsJson: JSON.stringify(args),
  });

const reason = (result: { output: string }) => (JSON.parse(result.output) as { reason?: string }).reason;

test("reading the settings is answered on the phone; changing them is checked here", () => {
  assert.deepEqual(buildNotificationTools().map((t) => t.name), ["get_notification_settings", "update_notification_settings"]);
  assert.ok(CLIENT_TOOL_NAMES.has("get_notification_settings"));
  assert.deepEqual([...NOTIFICATION_TOOL_NAMES], ["update_notification_settings"]);
});

test("each change in §7.3 reaches the app as asked", () => {
  // "Send it at 8 instead."
  assert.deepEqual(run({ change: "heads_up_time", at: "08:00" }).event, { time: { mode: "chosen", at: "08:00", days: "all" } });
  // "Not so early on weekends."
  assert.deepEqual(run({ change: "heads_up_time", at: "09:00", days: "weekends" }).event, {
    time: { mode: "chosen", at: "09:00", days: "weekends" },
  });
  // "Back to the usual time."
  assert.deepEqual(run({ change: "heads_up_usual_time" }).event, { time: { mode: "auto", days: "all" } });
  assert.deepEqual(run({ change: "heads_up_off" }).event, { headsUp: false });
  // "Stop reminding me to reflect."
  assert.deepEqual(run({ change: "reflect_reminders_off" }).event, { reflectReminders: false });
  // "No notifications about my prayer goal."
  assert.deepEqual(run({ change: "goal_notifications_off", goalId: "g1" }).event, { goalNotifications: { goalId: "g1", on: false } });
  // "Nothing this week."
  assert.deepEqual(run({ change: "pause", until: "2026-11-30" }).event, { pausedUntil: "2026-11-30" });
  assert.deepEqual(run({ change: "end_pause" }).event, { resume: true });
  assert.equal(run({ change: "reflect_reminders_off" }).output, '{"ok":true}');
});

test("what the model fills in beyond the change it names is ignored", () => {
  // As the real model sent it for "Stop reminding me to reflect": every field, current or empty.
  const filled = {
    change: "reflect_reminders_off",
    headsUp: true,
    at: "06:40",
    days: "all",
    goalId: "g1",
    until: "",
    confirmed: false,
  };
  assert.deepEqual(run(filled).event, { reflectReminders: false });
});

test("turning everything off, or a pause past two weeks, needs the user's yes first", () => {
  assert.equal(reason(run({ change: "all_off" })), "confirm_first");
  assert.equal(reason(run({ change: "all_off", confirmed: false })), "confirm_first");
  assert.deepEqual(run({ change: "all_off", confirmed: true }).event, { headsUp: false, reflectReminders: false });

  assert.ok(run({ change: "pause", until: "2026-12-09" }).event, "two weeks exactly");
  assert.equal(reason(run({ change: "pause", until: "2026-12-10" })), "confirm_first");
  assert.ok(run({ change: "pause", until: "2026-12-10", confirmed: true }).event);
});

test("what cannot be applied is refused, with nothing sent to the app", () => {
  const refused = (args: object, expected: string) => {
    const result = run(args);
    assert.equal(result.event, undefined, JSON.stringify(args));
    assert.equal(reason(result)?.split(":")[0], expected, JSON.stringify(args));
  };
  refused({}, "invalid_arguments");
  refused({ change: "everything" }, "invalid_arguments");
  refused({ change: "goal_notifications_off", goalId: "ghost" }, "unknown_goal");
  refused({ change: "goal_notifications_off" }, "unknown_goal");
  refused({ change: "heads_up_time" }, "invalid_arguments");
  refused({ change: "heads_up_time", at: "8am" }, "invalid_arguments");
  refused({ change: "heads_up_time", at: "24:00" }, "invalid_arguments");
  refused({ change: "pause", until: "2026-11-25" }, "pause_must_end_after_today");
  refused({ change: "pause", until: "2026-02-30" }, "invalid_arguments");
  refused({ change: "pause" }, "invalid_arguments");
});

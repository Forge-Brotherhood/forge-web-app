import { applyBeat, outboxItemFor } from "@/lib/heartbeat/apply";
import { DAY_MS, GRANT_DAYS, HEADS_UP_LATE_MS, HEADS_UP_WINDOW_MS, HOUR_MS, LEASE_MS, MAX_OUTBOX_ITEMS, RETRY } from "@/lib/heartbeat/config";
import { BRIEF_COLLECTION, OUTBOX_COLLECTION, openJson, sealJson } from "@/lib/heartbeat/crypto";
import type { BriefKeyVault } from "@/lib/heartbeat/kms";
import type { BeatModel } from "@/lib/heartbeat/model";
import { sendHeartbeatPush, type PushCode, type PushDeps } from "@/lib/heartbeat/push";
import { AFTER_QUIET_MINUTES, addDays, dueSendTime, isQuietMinute, localParts, nextSendTime, zonedInstant } from "@/lib/heartbeat/rules";
import { runBeat } from "@/lib/heartbeat/runBeat";
import { HEARTBEAT_TRIGGER, briefSchema } from "@/lib/heartbeat/schemas";
import type { Claimed, HeartbeatStore, RunRecord } from "@/lib/heartbeat/store";

/**
 * One cron run of the heartbeat (plan 7.6). It finds the users who are due, and for each one unwraps
 * the brief key, decrypts the brief, runs the same beat the app runs, applies the result to a new copy
 * of the brief, encrypts that and the result for the outbox, stores both, and drops the key.
 *
 * Privacy: the only things logged or recorded are ids, counts, sizes and outcome codes. Errors are
 * logged by name only, because a message (a failed parse, say) can quote the content it choked on.
 * A failure for one user never reaches another.
 */

export type LogEvent = Record<string, string | number | boolean | string[]>;

export type RunDeps = {
  store: HeartbeatStore;
  /** Only called once the switch is known to be on, so a missing AWS setup cannot stop expired grants being cleaned up. */
  getKms: () => BriefKeyVault;
  callModel: BeatModel;
  /** Sends the push a run earned. Absent: nothing is ever pushed. */
  push?: PushDeps;
  /** The per-user daily allowance for model calls. */
  allowModel: (userId: string, localDay: string) => Promise<boolean>;
  log: (event: LogEvent) => void;
  now?: () => Date;
  /** The global kill switch. Off: no key is unwrapped and no model is called; expired data is still deleted. */
  enabled: boolean;
  /** Stop starting new users after this long. */
  budgetMs?: number;
  /** Users processed at once. */
  concurrency?: number;
  /** Users processed in one run at most. */
  maxUsers?: number;
};

export type RunSummary = { enabled: boolean; lapsed: number; claimed: number; deferred: number; processed: number; outcomes: Record<string, number> };

const MAX_CLAIMS = 200;
const MAX_LAPSED = 100;

/** The grant has lapsed: its time is up, or no device has written the brief for as long as a grant lasts. */
export const isLapsed = (now: Date, grant: { expiresAt: Date } | null, brief: { deviceWrittenAt: Date } | null): boolean =>
  (grant !== null && grant.expiresAt.getTime() <= now.getTime()) ||
  (brief !== null && brief.deviceWrittenAt.getTime() <= now.getTime() - GRANT_DAYS * DAY_MS);

/** When quiet hours end, the next time. Null when it is not quiet now. */
export function quietEndsAt(now: Date, user: Pick<Claimed, "timezone" | "quietStart" | "quietEnd">): Date | null {
  const local = localParts(now, user.timezone);
  if (!isQuietMinute(local.minutes, { start: user.quietStart, end: user.quietEnd })) return null;
  const today = zonedInstant(local.date, user.quietEnd, user.timezone);
  return today.getTime() > now.getTime() ? today : zonedInstant(addDays(local.date, 1), user.quietEnd, user.timezone);
}

/**
 * When a run that is due now should wait until instead, or null to run now. A run at a send time
 * goes ahead, even in quiet hours. On a day with a send time still to come, the run waits for it, so
 * an earlier run does not take the day's post from the heads-up. Otherwise quiet hours hold it back,
 * never past the next send time.
 */
export function holdUntil(now: Date, user: Pick<Claimed, "timezone" | "quietStart" | "quietEnd" | "sendTimes">): Date | null {
  if (dueSendTime(user.sendTimes, now)) return null;
  const send = nextSendTime(user.sendTimes, now);
  if (send && localParts(send, user.timezone).date === localParts(now, user.timezone).date) return send;
  const end = quietEndsAt(now, user);
  return end && new Date(Math.min(end.getTime() + AFTER_QUIET_MINUTES * 60_000, send?.getTime() ?? Infinity));
}

/**
 * Why a push the run earned is held back, or null to send it (push-engagement-plan.md §4.2). A pause
 * holds back every push. A heads-up also waits on the person: none once they have been in the app
 * today or wrote the brief during the run, and none once it is too late to be a heads-up.
 */
export function heldBack(args: {
  now: Date;
  finishedAt: Date;
  /** The send time a heads-up run serves; null for any other run. */
  sendAt: Date | null;
  briefWritten: boolean;
  pausedUntil: Date | null;
  /** When a device last wrote the brief, by the server's clock. */
  receivedAt: Date | null;
  startOfDay: Date;
}): PushCode | null {
  if (args.pausedUntil && args.pausedUntil.getTime() > args.now.getTime()) return "paused";
  if (!args.sendAt) return null;
  if (!args.briefWritten) return "superseded";
  if (args.receivedAt && args.receivedAt.getTime() >= args.startOfDay.getTime()) return "here_today";
  if (args.finishedAt.getTime() - args.sendAt.getTime() > HEADS_UP_LATE_MS) return "late";
  return null;
}

export async function runHeartbeat(deps: RunDeps): Promise<RunSummary> {
  const { store, log } = deps;
  const clock = deps.now ?? (() => new Date());
  const startedAt = Date.now();
  const budgetMs = deps.budgetMs ?? 45_000;
  const concurrency = deps.concurrency ?? 3;
  const maxUsers = deps.maxUsers ?? 30;
  const summary: RunSummary = { enabled: deps.enabled, lapsed: 0, claimed: 0, deferred: 0, processed: 0, outcomes: {} };
  const count = (outcome: string) => (summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1);

  // Expired grants are cleaned up whether or not the switch is on: deleting is always safe.
  const sweepNow = clock();
  const lapsed = await store.findLapsed(sweepNow, new Date(sweepNow.getTime() - GRANT_DAYS * DAY_MS), MAX_LAPSED).catch(() => []);
  for (const userId of lapsed) {
    try {
      await store.deleteGrantData(userId);
      await store.recordRun(record(userId, "lapsed"), sweepNow);
      summary.lapsed += 1;
      log({ tag: "heartbeat.run", userId, outcome: "lapsed" });
    } catch (error) {
      log({ tag: "heartbeat.run", userId, outcome: "error", error: errorName(error) });
    }
  }

  if (!deps.enabled) {
    log({ tag: "heartbeat.batch", enabled: false, lapsed: summary.lapsed });
    return summary;
  }

  const kms = deps.getKms();
  while (Date.now() - startedAt < budgetMs && summary.processed < maxUsers && summary.claimed < MAX_CLAIMS) {
    const now = clock();
    const writtenAfter = new Date(now.getTime() - GRANT_DAYS * DAY_MS);
    const claimed = await store.claimDue(now, writtenAfter, concurrency, new Date(now.getTime() + LEASE_MS));
    if (claimed.length === 0) break;
    summary.claimed += claimed.length;

    const toRun: Claimed[] = [];
    for (const user of claimed) {
      let until: Date | null = null;
      try {
        until = holdUntil(now, user);
      } catch {
        until = new Date(now.getTime() + RETRY.stuck);
      }
      if (until) {
        summary.deferred += 1;
        await store.release(user.userId, until, now).catch(() => undefined);
      } else {
        toRun.push(user);
      }
    }

    const outcomes = await Promise.all(toRun.map((user) => processUser(deps, kms, user, clock)));
    summary.processed += toRun.length;
    outcomes.forEach(count);
  }

  log({ tag: "heartbeat.batch", enabled: true, ...flat(summary), latencyMs: Date.now() - startedAt });
  return summary;
}

const flat = (s: RunSummary): LogEvent => ({
  lapsed: s.lapsed,
  claimed: s.claimed,
  deferred: s.deferred,
  processed: s.processed,
  outcomes: Object.entries(s.outcomes).map(([k, v]) => `${k}:${v}`),
});

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

const record = (userId: string, outcome: string, beat: Partial<RunRecord> = {}): RunRecord => ({
  userId,
  trigger: HEARTBEAT_TRIGGER,
  outcome,
  modelCalled: false,
  posts: 0,
  activities: 0,
  dropped: 0,
  pushed: 0,
  durationMs: 0,
  ...beat,
});

/** Runs one claimed user. Never throws: whatever goes wrong becomes an outcome code and the user is released. */
async function processUser(deps: RunDeps, kms: BriefKeyVault, user: Claimed, clock: () => Date): Promise<string> {
  const { store, log } = deps;
  const { userId } = user;
  const startedAt = Date.now();
  const now = clock();
  // A run at one of the device's send times is a heads-up run (push-engagement-plan.md §4).
  const sendAt = dueSendTime(user.sendTimes, now);
  const nextSend = nextSendTime(user.sendTimes, now);
  /** When to look again: after `ms`, or at the next send time if that comes first. */
  const lookAgain = (ms: number) => new Date(Math.min(now.getTime() + ms, nextSend?.getTime() ?? Infinity));
  // A heads-up run that hit a passing failure tries again soon, while there is still time to be a heads-up.
  const transient = sendAt ? RETRY.headsUp : RETRY.transient;
  let key: Buffer | null = null;
  let counts: Partial<RunRecord> = {};
  let pushCode: PushCode | undefined;
  // Reason codes only, as the app's own beat route logs them: never what the model wrote.
  let droppedCodes: string[] = [];

  const end = async (outcome: string, retryInMs?: number): Promise<string> => {
    const row = record(userId, outcome, { ...counts, durationMs: Date.now() - startedAt });
    try {
      if (retryInMs !== undefined) await store.release(userId, lookAgain(retryInMs), now);
      await store.recordRun(row, now);
    } catch (error) {
      log({ tag: "heartbeat.run", userId, outcome: "error", error: errorName(error) });
    }
    log({
      tag: "heartbeat.run",
      userId,
      outcome,
      modelCalled: row.modelCalled,
      posts: row.posts,
      activities: row.activities,
      dropped: row.dropped,
      ...(droppedCodes.length ? { droppedCodes } : {}),
      pushed: row.pushed,
      ...(pushCode ? { push: pushCode } : {}),
      ...(row.staleness ? { staleness: row.staleness } : {}),
      durationMs: row.durationMs,
    });
    return outcome;
  };

  try {
    const input = await store.loadForRun(userId);
    if (!input) return await end("no_state");

    if (isLapsed(now, input.grant, input.brief)) {
      await store.deleteGrantData(userId);
      return await end("lapsed", RETRY.lapsed);
    }
    if (!input.grant || !input.brief) return await end("no_grant", RETRY.stuck);
    // A rotation is in flight: the grant has a new key, the brief is still under the old one.
    if (input.grant.keyId !== input.brief.keyId) return await end("key_mismatch", transient);
    if (input.outboxCount >= MAX_OUTBOX_ITEMS) return await end("outbox_full", RETRY.stuck);

    try {
      key = await kms.unwrap(userId, input.grant.wrappedKey);
    } catch {
      return await end("kms_failed", transient);
    }

    let brief;
    try {
      const parsed = briefSchema.safeParse(openJson(key, userId, BRIEF_COLLECTION, input.brief.ciphertext));
      if (!parsed.success) return await end("brief_invalid", RETRY.stuck);
      brief = parsed.data;
    } catch {
      return await end("decrypt_failed", RETRY.stuck);
    }

    const localDay = localParts(now, brief.person.timezone).date;
    const output = await runBeat(brief, now, {
      trigger: HEARTBEAT_TRIGGER,
      callModel: deps.callModel,
      userId,
      allowModel: () => deps.allowModel(userId, localDay),
      headsUp: sendAt !== null,
    });
    counts = {
      staleness: output.meta.staleness,
      modelCalled: output.meta.modelCalled,
      posts: output.posts.length,
      activities: output.activities.length,
      dropped: output.meta.dropped.length,
    };
    droppedCodes = output.meta.dropped.map((d) => d.code);

    const next = applyBeat(brief, output, now);
    const item = outboxItemFor(output, now);
    const { briefWritten } = await store.finishRun(userId, {
      now,
      nextBeatAt: new Date(Math.min(Date.parse(output.nextBeatAt), nextSend?.getTime() ?? Infinity)),
      ...(next ? { brief: { ciphertext: sealJson(key, userId, BRIEF_COLLECTION, next), expectedRevision: input.brief.revision } } : {}),
      ...(item ? { outbox: [{ ciphertext: sealJson(key, userId, OUTBOX_COLLECTION, item), keyId: input.grant.keyId }] } : {}),
    });

    // The push goes last, once the result is stored, and only while the key is still in memory and the
    // grant it belongs to still stands (a revoke or a rotation during the run means no push). Whatever
    // happens here, the run and the outbox item are already done. A device that sends send times gets
    // its push from the heads-up run only; one that sends none keeps the older behaviour.
    if (deps.push && item && (sendAt || user.sendTimes.length === 0)) {
      const grant = await store.getGrant(userId).catch(() => null);
      if (grant?.keyId === input.grant.keyId) {
        const tz = brief.person.timezone;
        const held = heldBack({
          now,
          finishedAt: clock(),
          sendAt,
          briefWritten,
          pausedUntil: input.pausedUntil,
          receivedAt: input.brief.receivedAt,
          startOfDay: zonedInstant(localDay, "00:00", tz),
        });
        if (held) {
          pushCode = held;
        } else {
          const sent = await sendHeartbeatPush(deps.push, {
            key,
            userId,
            keyId: input.grant.keyId,
            brief,
            output,
            pushEnabled: input.pushEnabled,
            claimDay: () => store.claimHeadsUpDay(userId, localDay, now),
            ...(sendAt ? { delivery: { expiresAt: new Date(sendAt.getTime() + HEADS_UP_WINDOW_MS), collapseId: `headsup-${localDay}` } } : {}),
          });
          counts = { ...counts, pushed: sent.pushed };
          pushCode = sent.code;
        }
      }
    }
    // finishRun already moved nextBeatAt and released the lease, so only the record is written.
    return await end(next === null ? "apply_failed" : briefWritten ? "ok" : "ok_superseded");
  } catch (error) {
    log({ tag: "heartbeat.run", userId, outcome: "error", error: errorName(error) });
    return await end("error", transient);
  } finally {
    key?.fill(0);
  }
}

import type { PushPayload, PushResult } from "@/lib/apns";
import { PUSH_COLLECTION, sealJson } from "@/lib/heartbeat/crypto";
import { isDiscreet } from "@/lib/heartbeat/rules";
import type { BeatOutput, Brief } from "@/lib/heartbeat/schemas";
import { NEUTRAL_NOTIFICATION_TEXT, NEUTRAL_NOTIFICATION_TITLE } from "@/lib/heartbeat/terms";

/**
 * The push a heartbeat run sends (plan 7.7, Phase 5). Apple and Google can read a push, so what they
 * carry is fixed neutral text. The real text and where a tap goes travel sealed under the user's brief
 * key in a data field that only the device can open (contract: plan section 15).
 *
 * Privacy: nothing here logs. The result is a count and a code. A failure never throws, so it can never
 * fail the run or touch the outbox item that was already stored.
 */

export const PUSH_TYPE = "heartbeat_push";
export const PUSH_VERSION = "1";
/**
 * The sealed JSON may not pass this many bytes. APNs allows 4096 for the whole payload; this leaves
 * room for the alert, the key id and the base64 growth (4/3) plus the nonce and tag.
 */
export const MAX_SEALED_PLAINTEXT_BYTES = 1500;

/** What the device learns once it opens the sealed field. `text` is absent when the notification must name nothing. */
export type SealedTarget = { goalId: string; activityId?: string; text?: string };

export type PushDeps = {
  /** The user's active iOS tokens. */
  tokensFor: (userId: string) => Promise<string[]>;
  send: (tokens: string[], payload: PushPayload) => Promise<PushResult>;
  /** Called with the tokens the sender reports as invalid. */
  cleanup: (tokens: string[]) => Promise<void>;
};

/** The one post that earned a notification. The budget lets at most one through a day; a run sends one push at most. */
export const notifyPost = (output: Pick<BeatOutput, "posts">) => output.posts.find((p) => p.notify !== undefined);

const bytes = (target: SealedTarget): number => Buffer.byteLength(JSON.stringify(target), "utf8");

/** Cuts the text on a character boundary (never mid surrogate pair), with an ellipsis, until the whole fits. */
export function fitTarget(target: SealedTarget, maxBytes = MAX_SEALED_PLAINTEXT_BYTES): SealedTarget {
  if (target.text === undefined || bytes(target) <= maxBytes) return target;
  const chars = [...target.text];
  for (let keep = chars.length - 1; keep > 0; keep--) {
    const candidate = { ...target, text: `${chars.slice(0, keep).join("")}…` };
    if (bytes(candidate) <= maxBytes) return candidate;
  }
  const { text: _dropped, ...withoutText } = target;
  return withoutText;
}

/** The push for a result, or null when nothing in it earned one. Seals with the key; the caller still owns (and zeroes) it. */
export function buildHeartbeatPush(args: { key: Buffer; userId: string; keyId: string; brief: Brief; output: Pick<BeatOutput, "posts"> }): PushPayload | null {
  const post = notifyPost(args.output);
  const goal = post && args.brief.goals.find((g) => g.id === post.goalId);
  if (!post?.notify || !goal) return null;

  // A discreet goal, or text the rules already replaced with the neutral line, sends no text: the device keeps the neutral one.
  const showText = !isDiscreet(goal) && post.notify.text !== NEUTRAL_NOTIFICATION_TEXT;
  const target = fitTarget({
    goalId: post.goalId,
    ...(post.activityId ? { activityId: post.activityId } : {}),
    ...(showText ? { text: post.notify.text } : {}),
  });

  return {
    title: NEUTRAL_NOTIFICATION_TITLE,
    body: NEUTRAL_NOTIFICATION_TEXT,
    data: { type: PUSH_TYPE, v: PUSH_VERSION, keyId: args.keyId, sealed: sealJson(args.key, args.userId, PUSH_COLLECTION, target) },
  };
}

/** A code for the log. Never text. */
export type PushCode = "none" | "off" | "no_tokens" | "sent" | "failed" | "error";

/** Sends the push this run earned, if any. Never throws. */
export async function sendHeartbeatPush(
  deps: PushDeps,
  args: { key: Buffer; userId: string; keyId: string; brief: Brief; output: Pick<BeatOutput, "posts">; pushEnabled: boolean }
): Promise<{ pushed: number; code: PushCode }> {
  try {
    if (!notifyPost(args.output)) return { pushed: 0, code: "none" };
    if (!args.pushEnabled) return { pushed: 0, code: "off" };
    const tokens = await deps.tokensFor(args.userId);
    if (tokens.length === 0) return { pushed: 0, code: "no_tokens" };

    const payload = buildHeartbeatPush(args);
    if (!payload) return { pushed: 0, code: "none" };
    const result = await deps.send(tokens, payload);
    if (result.failedTokens.length > 0) await deps.cleanup(result.failedTokens).catch(() => undefined);
    return result.successCount > 0 ? { pushed: 1, code: "sent" } : { pushed: 0, code: "failed" };
  } catch {
    return { pushed: 0, code: "error" };
  }
}

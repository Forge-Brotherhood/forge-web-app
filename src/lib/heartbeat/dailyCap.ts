import { CacheKeys, getKVClient } from "@/lib/kv";

/**
 * A simple per-user daily limit on beats that call the model. These are model calls the user did
 * not start themselves, so they are counted. The count lives in KV (a number under an id and a
 * day, nothing else). If KV cannot be reached the count is kept in this process instead: it
 * resets with the process, but a missing cache must not stop the app, and must not leave the
 * limit off.
 */

export const HEARTBEAT_MODEL_CALLS_PER_DAY = 4;

const KV_TIMEOUT_MS = 1000;
const TTL_SECONDS = 2 * 24 * 60 * 60;

const local = new Map<string, number>();

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("kv timeout")), KV_TIMEOUT_MS))]);

/** Takes one model call from today's allowance. False when it is used up. The day is the user's local date. */
export async function takeModelCall(userId: string, day: string, limit = HEARTBEAT_MODEL_CALLS_PER_DAY): Promise<boolean> {
  const key = CacheKeys.heartbeatModelCalls(userId, day);
  let used: number;
  try {
    const kv = getKVClient();
    used = (await withTimeout(kv.get<number>(key)))?.data ?? local.get(key) ?? 0;
    if (used >= limit) return false;
    await withTimeout(kv.set(key, used + 1, TTL_SECONDS));
  } catch {
    used = local.get(key) ?? 0;
    if (used >= limit) return false;
  }
  local.set(key, used + 1);
  return true;
}

/**
 * The heartbeat's allowance with the plan: a free account never calls the model here (pricing-plan.md
 * §4), and gets the rules and the plain reminders. If the plan cannot be looked up, no model either.
 */
export const heartbeatModelAllowed =
  (isPlus: (userId: string) => Promise<boolean>, take: typeof takeModelCall = takeModelCall) =>
  async (userId: string, day: string): Promise<boolean> =>
    (await isPlus(userId).catch(() => false)) && take(userId, day);

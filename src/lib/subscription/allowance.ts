/**
 * The free weekly allowance of Lumen replies (pricing-plan.md §3, §14). A rolling 7-day window starts
 * at the first counted reply after the last one ended. The account's first 24 hours are not counted
 * against the week, up to FIRST_DAY_CAP replies. Counts and times only, never what was said.
 */

const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;
export const FIRST_DAY_MS = 24 * HOUR_MS;
export const FIRST_DAY_CAP = 30;

export type AllowanceRow = {
  windowStart: Date | null;
  used: number;
  firstDayUsed: number;
  gateHits: number;
  lastGateAt: Date | null;
};

export type AllowanceJson = { limit: number; used: number; remaining: number; resetsAt: string | null };

export const EMPTY_ALLOWANCE: AllowanceRow = { windowStart: null, used: 0, firstDayUsed: 0, gateHits: 0, lastGateAt: null };

export const freeRepliesPerWeek = (): number => {
  const n = Number(process.env.FREE_REPLIES_PER_WEEK);
  return Number.isInteger(n) && n >= 0 ? n : 20;
};

type Clock = { now: Date; accountCreatedAt: Date; limit: number };

const windowOpen = (row: AllowanceRow, now: Date): row is AllowanceRow & { windowStart: Date } =>
  row.windowStart !== null && now.getTime() < row.windowStart.getTime() + WEEK_MS;

const firstDayLeft = (row: AllowanceRow, { now, accountCreatedAt }: Clock): number =>
  now.getTime() < accountCreatedAt.getTime() + FIRST_DAY_MS ? Math.max(0, FIRST_DAY_CAP - row.firstDayUsed) : 0;

/** The allowance as the app sees it. `remaining` includes what is left of the open first day. */
export function allowanceView(row: AllowanceRow, clock: Clock): AllowanceJson {
  const open = windowOpen(row, clock.now);
  const used = open ? row.used : 0;
  return {
    limit: clock.limit,
    used,
    remaining: Math.max(0, clock.limit - used) + firstDayLeft(row, clock),
    resetsAt: open ? new Date(row.windowStart!.getTime() + WEEK_MS).toISOString() : null,
  };
}

export type TakeResult = { allowed: true; next: AllowanceRow } | { allowed: false; refused: AllowanceRow };

/** Takes one reply. Refused when the week is used up; `refused` is the row with the gate hit recorded. */
export function takeReply(row: AllowanceRow, clock: Clock): TakeResult {
  if (firstDayLeft(row, clock) > 0) return { allowed: true, next: { ...row, firstDayUsed: row.firstDayUsed + 1 } };
  const open = windowOpen(row, clock.now);
  const used = open ? row.used : 0;
  if (used < clock.limit) {
    return { allowed: true, next: { ...row, windowStart: open ? row.windowStart : clock.now, used: used + 1 } };
  }
  return { allowed: false, refused: { ...row, gateHits: row.gateHits + 1, lastGateAt: clock.now } };
}

export type AllowanceStore = {
  /** The person's row (null when they have none yet) and when their account was made. */
  load: (userId: string) => Promise<{ row: AllowanceRow | null; accountCreatedAt: Date }>;
  /** Writes `next` only if the row is still `prev` (null: still missing). False when it changed meanwhile. */
  save: (userId: string, prev: AllowanceRow | null, next: AllowanceRow) => Promise<boolean>;
};

export type TakeOutcome = { allowed: true } | { allowed: false; allowance: AllowanceJson; commitRefusal: () => Promise<void> };

/**
 * Checks and takes one reply before the model call. A refusal is not written until `commitRefusal`,
 * so a reply let through anyway (a hard moment) leaves no gate hit. Two requests at once cannot both
 * take the last reply: a save that lost the race is tried again on the new row.
 */
export async function takeChatReply(store: AllowanceStore, userId: string, now: Date, limit = freeRepliesPerWeek()): Promise<TakeOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { row, accountCreatedAt } = await store.load(userId);
    const clock = { now, accountCreatedAt, limit };
    const current = row ?? EMPTY_ALLOWANCE;
    const result = takeReply(current, clock);
    if (!result.allowed) {
      return {
        allowed: false,
        allowance: allowanceView(current, clock),
        // A lost race here only drops one gate hit from the count.
        commitRefusal: async () => void (await store.save(userId, row, result.refused)),
      };
    }
    if (await store.save(userId, row, result.next)) return { allowed: true };
  }
  throw new Error("allowance_conflict");
}

/** The current allowance, for the status route. */
export async function readAllowance(store: AllowanceStore, userId: string, now: Date, limit = freeRepliesPerWeek()): Promise<AllowanceJson> {
  const { row, accountCreatedAt } = await store.load(userId);
  return allowanceView(row ?? EMPTY_ALLOWANCE, { now, accountCreatedAt, limit });
}

/** The heartbeat's limits, in one place. */

/** A grant lasts this long. Each renewal from a device starts it again. */
export const GRANT_DAYS = 14;
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** The server keeps at most this many outbox items for a user who is not taking them. Past it the user's runs wait. */
export const MAX_OUTBOX_ITEMS = 50;
/** The most a device may upload as a brief (base64 characters). The brief itself is at most 32,000 characters of JSON. */
export const MAX_BRIEF_CIPHERTEXT_CHARS = 200_000;

/** How long a claimed user is held for one run. A run that dies without releasing frees them after this. */
export const LEASE_MS = 5 * 60_000;

/** How long to wait before looking again at a user whose run could not go ahead, by cause. A heads-up run that hit a passing failure tries again sooner. */
export const RETRY = { transient: HOUR_MS, stuck: 6 * HOUR_MS, lapsed: DAY_MS, headsUp: 5 * 60_000 } as const;

/**
 * The heads-up (push-engagement-plan.md §4). A send time from the device stays due this long, so a
 * run that failed can try again; it is also how long the push may wait on a phone that is off.
 */
export const HEADS_UP_WINDOW_MS = HOUR_MS;
/** A heads-up run that finishes later than this after its send time still posts, but sends no push. */
export const HEADS_UP_LATE_MS = 10 * 60_000;
/** On a heads-up run, an activity planned for this soon counts as today's subject. */
export const HEADS_UP_AHEAD_MINUTES = 60;

/** Nothing runs unless the switch is on. Off by default: the heartbeat does nothing until the owner turns it on. */
export const isHeartbeatEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.HEARTBEAT_ENABLED?.trim().toLowerCase() === "true";

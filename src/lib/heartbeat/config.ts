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

/** How long to wait before looking again at a user whose run could not go ahead, by cause. */
export const RETRY = { transient: HOUR_MS, stuck: 6 * HOUR_MS, lapsed: DAY_MS } as const;

/** Nothing runs unless the switch is on. Off by default: the heartbeat does nothing until the owner turns it on. */
export const isHeartbeatEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.HEARTBEAT_ENABLED?.trim().toLowerCase() === "true";

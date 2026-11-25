import fs from "node:fs";
import path from "node:path";

/**
 * The dev clock: a shift added to "now" so what happens over days (goals, the heartbeat) can be
 * tested without waiting. It only exists on a dev server (`next dev`) with DEV_CLOCK_ENABLED=true;
 * a production build never reads it. The shift is kept in a git-ignored file, so it outlives a
 * restart and every worker of the dev server sees the same one. The app takes it from
 * GET /api/dev/clock so both sides go by the same time.
 */

const FILE = path.join(process.cwd(), ".dev-clock.json");
/** How far ahead it can go. */
export const MAX_DEV_CLOCK_OFFSET_MS = 365 * 86_400_000;

export const isDevClockEnabled = (): boolean =>
  process.env.NODE_ENV === "development" && process.env.DEV_CLOCK_ENABLED === "true";

/** How far ahead of the real time the dev clock is, in ms. 0 when it is off. */
export function devClockOffsetMs(): number {
  if (!isDevClockEnabled()) return 0;
  try {
    const { offsetMs } = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Number.isFinite(offsetMs) ? offsetMs : 0;
  } catch {
    return 0;
  }
}

/** Now, as the app's goals and heartbeat go by it. The real time unless the dev clock is on. */
export const appNow = (): Date => new Date(Date.now() + devClockOffsetMs());

export function setDevClockOffsetMs(offsetMs: number): void {
  fs.writeFileSync(FILE, JSON.stringify({ offsetMs }));
}

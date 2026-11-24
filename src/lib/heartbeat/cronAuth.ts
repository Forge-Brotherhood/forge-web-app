import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`. The compare takes the same time wherever
 * the two differ (both sides are hashed to the same length first), and nothing passes if the secret
 * is not set.
 */
export function isCronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`));
}

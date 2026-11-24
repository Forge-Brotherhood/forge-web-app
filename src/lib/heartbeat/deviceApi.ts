import { z } from "zod";
import { DAY_MS, GRANT_DAYS, MAX_BRIEF_CIPHERTEXT_CHARS } from "@/lib/heartbeat/config";
import { BRIEF_KEY_BYTES } from "@/lib/heartbeat/crypto";
import type { BriefKeyVault } from "@/lib/heartbeat/kms";
import { clock, instant, timeZone } from "@/lib/heartbeat/schemas";
import type { HeartbeatStore, PutBriefResult } from "@/lib/heartbeat/store";

/**
 * What the app's requests do, apart from HTTP: the request shapes and the work behind each route.
 * The server never sees a brief or a result in the clear. The one secret it is handed is the brief key,
 * and that goes straight to KMS (wrapped) and is zeroed; it is neither stored plain nor logged.
 */

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const putGrantSchema = z.object({
  /** The 32-byte brief key, base64. */
  key: base64.refine((v) => v.length === 44 && Buffer.from(v, "base64").length === BRIEF_KEY_BYTES, "must be 32 bytes"),
  /** The device's own name for this key. Comes back on the brief and every outbox item, so the device knows which key to open it with. */
  keyId,
});

export const putBriefSchema = z.object({
  ciphertext: base64.max(MAX_BRIEF_CIPHERTEXT_CHARS),
  keyId,
  /** When the device wrote this brief. */
  writtenAt: instant,
});

export const putStateSchema = z.object({
  enabled: z.boolean(),
  timezone: timeZone,
  quietHours: z.object({ start: clock, end: clock }),
  pushEnabled: z.boolean(),
});

export const ackOutboxSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) });

export const OUTBOX_PAGE = 50;

export async function putGrant(
  deps: { store: HeartbeatStore; kms: BriefKeyVault },
  userId: string,
  body: z.infer<typeof putGrantSchema>,
  now: Date
): Promise<{ ok: true; expiresAt: string } | { ok: false; reason: "state_required" }> {
  const key = Buffer.from(body.key, "base64");
  let wrappedKey: string;
  try {
    wrappedKey = await deps.kms.wrap(userId, key);
  } finally {
    key.fill(0);
  }
  const expiresAt = new Date(now.getTime() + GRANT_DAYS * DAY_MS);
  const stored = await deps.store.putGrant(userId, { wrappedKey, keyId: body.keyId, expiresAt }, now);
  return stored ? { ok: true, expiresAt: expiresAt.toISOString() } : { ok: false, reason: "state_required" };
}

export const putBrief = (
  store: HeartbeatStore,
  userId: string,
  body: z.infer<typeof putBriefSchema>,
  now: Date
): Promise<PutBriefResult> =>
  // A device clock a little ahead must not make a brief look newer than now.
  store.putBrief(userId, { ciphertext: body.ciphertext, keyId: body.keyId, deviceWrittenAt: new Date(Math.min(Date.parse(body.writtenAt), now.getTime())) }, now);

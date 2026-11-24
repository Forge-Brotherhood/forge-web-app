import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * How the heartbeat's brief and outbox items are encrypted: AES-256-GCM under the user's brief key,
 * the same shape as the vault's records (CryptoKit's `AES.GCM.SealedBox.combined`):
 *
 *   base64( nonce (12 bytes) || ciphertext || tag (16 bytes) )
 *
 * The associated data is the UTF-8 text `<collection>/<userId>` (the vault binds `<collection>/<id>`),
 * so a ciphertext cannot be passed off as another user's or as the other collection's. The key is
 * used as it is: no derivation. Nothing here logs or keeps a key; callers zero theirs after use.
 */

export const BRIEF_COLLECTION = "heartbeat_brief";
export const OUTBOX_COLLECTION = "heartbeat_outbox";
/** The notification's sealed payload (Phase 5): same key, a third binding. Only the push builder and the device use it. */
export const PUSH_COLLECTION = "heartbeat_push";
export type HeartbeatCollection = typeof BRIEF_COLLECTION | typeof OUTBOX_COLLECTION | typeof PUSH_COLLECTION;

export const BRIEF_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export const associatedData = (userId: string, collection: HeartbeatCollection): Buffer => Buffer.from(`${collection}/${userId}`, "utf8");

export function seal(key: Buffer, userId: string, collection: HeartbeatCollection, plaintext: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(userId, collection));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
}

/** Throws if the key, the user or the collection is not the one it was sealed with, or it was altered. */
export function open(key: Buffer, userId: string, collection: HeartbeatCollection, ciphertext: string): Buffer {
  const data = Buffer.from(ciphertext, "base64");
  if (data.length < NONCE_BYTES + TAG_BYTES) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, NONCE_BYTES));
  decipher.setAAD(associatedData(userId, collection));
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)), decipher.final()]);
}

export const sealJson = (key: Buffer, userId: string, collection: HeartbeatCollection, value: unknown): string =>
  seal(key, userId, collection, Buffer.from(JSON.stringify(value), "utf8"));

export function openJson(key: Buffer, userId: string, collection: HeartbeatCollection, ciphertext: string): unknown {
  const plain = open(key, userId, collection, ciphertext);
  try {
    return JSON.parse(plain.toString("utf8"));
  } finally {
    plain.fill(0);
  }
}

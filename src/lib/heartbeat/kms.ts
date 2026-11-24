import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { BRIEF_KEY_BYTES } from "@/lib/heartbeat/crypto";

/**
 * Wraps and unwraps a user's brief key with an AWS KMS key. The 32-byte key goes straight into KMS
 * Encrypt (it is far under the 4 KB limit) with the user's database id as the encryption context, so
 * a wrapped key only unwraps for that user, and the IAM identity may use the KMS key only when that
 * context is present. The plain key is never logged or stored; callers zero the buffer they get.
 *
 * Everything outside this file talks to the small `BriefKeyVault` interface, so tests inject a fake
 * and nothing calls AWS from a test.
 */

export interface BriefKeyVault {
  /** The key, wrapped for this user. Base64 of the KMS ciphertext. */
  wrap(userId: string, key: Buffer): Promise<string>;
  /** The plain key. The caller must zero it (`buffer.fill(0)`) as soon as it is done. */
  unwrap(userId: string, wrapped: string): Promise<Buffer>;
}

/** The part of the AWS client used here, so a test can stand in for it. */
export type KmsSender = { send(command: EncryptCommand | DecryptCommand): Promise<any> };

export function createAwsBriefKeyVault(options: { keyId: string; client: KmsSender }): BriefKeyVault {
  const { keyId, client } = options;
  return {
    async wrap(userId, key) {
      if (key.length !== BRIEF_KEY_BYTES) throw new Error("brief key must be 32 bytes");
      const out = await client.send(new EncryptCommand({ KeyId: keyId, Plaintext: key, EncryptionContext: { userId } }));
      if (!out.CiphertextBlob) throw new Error("KMS returned no ciphertext");
      return Buffer.from(out.CiphertextBlob).toString("base64");
    },
    async unwrap(userId, wrapped) {
      const out = await client.send(
        new DecryptCommand({ KeyId: keyId, CiphertextBlob: Buffer.from(wrapped, "base64"), EncryptionContext: { userId } })
      );
      const plaintext: Uint8Array | undefined = out.Plaintext;
      if (!plaintext) throw new Error("KMS returned no plaintext");
      const key = Buffer.from(plaintext);
      plaintext.fill(0);
      if (key.length !== BRIEF_KEY_BYTES) {
        key.fill(0);
        throw new Error("unwrapped key has the wrong length");
      }
      return key;
    },
  };
}

export class HeartbeatNotConfigured extends Error {
  constructor() {
    super("heartbeat KMS is not configured");
    this.name = "HeartbeatNotConfigured";
  }
}

let cached: BriefKeyVault | null = null;

/** The KMS-backed vault from the environment. Throws `HeartbeatNotConfigured` if any variable is missing. */
export function getBriefKeyVault(): BriefKeyVault {
  if (cached) return cached;
  const keyId = process.env.HEARTBEAT_KMS_KEY_ID;
  const region = process.env.HEARTBEAT_AWS_REGION;
  const accessKeyId = process.env.HEARTBEAT_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HEARTBEAT_AWS_SECRET_ACCESS_KEY;
  if (!keyId || !region || !accessKeyId || !secretAccessKey) throw new HeartbeatNotConfigured();
  cached = createAwsBriefKeyVault({ keyId, client: new KMSClient({ region, credentials: { accessKeyId, secretAccessKey } }) });
  return cached;
}

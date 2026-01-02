/**
 * Pipeline Vault
 *
 * Encrypted storage for raw content (full prompts, messages, tool outputs).
 * Artifacts only contain redacted previews with vault pointers.
 */

import { prisma } from "@/lib/prisma";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import { PipelineStage, type RunContext } from "./types";

// =============================================================================
// Configuration
// =============================================================================

// Get encryption key from environment (32 bytes for AES-256)
function getVaultKey(): Buffer {
  const keyHex = process.env.VAULT_ENCRYPTION_KEY;
  if (!keyHex) {
    // In development, use a deterministic key (NOT for production)
    if (process.env.NODE_ENV === "development") {
      return createHash("sha256")
        .update("dev-vault-key")
        .digest();
    }
    throw new Error("VAULT_ENCRYPTION_KEY environment variable is required");
  }
  return Buffer.from(keyHex, "hex");
}

// =============================================================================
// Encryption Helpers
// =============================================================================

interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encrypt(text: string): EncryptedData {
  const key = getVaultKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag,
  };
}

function decrypt(ciphertext: string, ivHex: string, authTagHex: string): string {
  const key = getVaultKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// =============================================================================
// Vault Operations
// =============================================================================

/**
 * Store raw content in encrypted vault.
 * Returns a vault reference pointer.
 */
export async function storeInVault(
  ctx: RunContext,
  stage: PipelineStage,
  rawContent: unknown
): Promise<string> {
  console.log("[Vault] storeInVault called:", { runId: ctx.runId, stage, mode: ctx.mode });

  // Only store in vault during debug mode
  if (ctx.mode !== "debug") {
    console.log("[Vault] Skipping store - not in debug mode");
    return "";
  }

  const contentStr = JSON.stringify(rawContent);
  const encrypted = encrypt(contentStr);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // Debug vault expires in 7 days

  try {
    await prisma.pipelineVault.upsert({
      where: {
        runId_stage: { runId: ctx.runId, stage },
      },
      create: {
        runId: ctx.runId,
        stage,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        createdAt: new Date(),
        expiresAt,
      },
      update: {
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        expiresAt,
      },
    });
  } catch (error) {
    console.error("[Vault] Failed to store content:", error);
    return "";
  }

  const vaultRef = `vault://${ctx.runId}/${stage}`;
  console.log("[Vault] Successfully stored, returning ref:", vaultRef);
  return vaultRef;
}

/**
 * Retrieve raw content from vault.
 */
export async function retrieveFromVault(
  runId: string,
  stage: PipelineStage
): Promise<unknown | null> {
  console.log("[Vault] retrieveFromVault called:", { runId, stage });

  const entry = await prisma.pipelineVault.findUnique({
    where: { runId_stage: { runId, stage } },
  });

  if (!entry) {
    console.log("[Vault] No entry found for:", { runId, stage });
    return null;
  }

  console.log("[Vault] Found entry, decrypting...");

  try {
    const decrypted = decrypt(
      entry.encryptedContent,
      entry.iv,
      entry.authTag
    );
    return JSON.parse(decrypted);
  } catch (error) {
    console.error("[Vault] Failed to decrypt content:", error);
    return null;
  }
}

/**
 * Parse a vault reference to extract runId and stage.
 */
export function parseVaultRef(
  ref: string
): { runId: string; stage: PipelineStage } | null {
  const match = ref.match(/^vault:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return {
    runId: match[1],
    stage: match[2] as PipelineStage,
  };
}

/**
 * Delete vault entry for a run/stage.
 */
export async function deleteFromVault(
  runId: string,
  stage?: PipelineStage
): Promise<void> {
  if (stage) {
    await prisma.pipelineVault.delete({
      where: { runId_stage: { runId, stage } },
    });
  } else {
    await prisma.pipelineVault.deleteMany({
      where: { runId },
    });
  }
}

/**
 * Clean up expired vault entries.
 */
export async function cleanupExpiredVault(): Promise<number> {
  const result = await prisma.pipelineVault.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

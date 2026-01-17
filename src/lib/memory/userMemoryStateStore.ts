import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type MemoryNote = {
  text: string;
  keywords: string[];
  createdAtISO: string;
  expiresAtISO?: string;
};

const MEMORY_STATE_SCHEMA_VERSION = "forge.user_memory_state.v1" as const;

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeKeyword = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const snake = raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!snake) return null;
  return snake.length > 24 ? snake.slice(0, 24) : snake;
};

const coerceKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const k = normalizeKeyword(item);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 8) break;
  }
  return out;
};

const coerceNote = (value: unknown): MemoryNote | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const text = typeof v.text === "string" ? v.text.trim() : "";
  if (!text) return null;

  const createdAtISO = typeof v.createdAtISO === "string" ? v.createdAtISO : new Date().toISOString();
  const expiresAtISO = typeof v.expiresAtISO === "string" ? v.expiresAtISO : undefined;

  return {
    text,
    keywords: coerceKeywords(v.keywords),
    createdAtISO,
    ...(expiresAtISO ? { expiresAtISO } : {}),
  };
};

export async function getUserMemoryState(userId: string): Promise<{
  schemaVersion: typeof MEMORY_STATE_SCHEMA_VERSION;
  globalNotes: MemoryNote[];
}> {
  const row = await prisma.userMemoryState.findUnique({
    where: { userId },
    select: { schemaVersion: true, globalNotes: true },
  });

  const notesRaw = row?.globalNotes;
  const globalNotes = Array.isArray(notesRaw)
    ? (notesRaw as unknown[]).map(coerceNote).filter((n): n is MemoryNote => Boolean(n))
    : [];

  // Dedupe by normalized text (keep most recent createdAtISO where possible)
  const byKey = new Map<string, MemoryNote>();
  for (const n of globalNotes) {
    const key = normalize(n.text);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, n);
      continue;
    }
    const existingTs = Date.parse(existing.createdAtISO);
    const nextTs = Date.parse(n.createdAtISO);
    if (Number.isFinite(nextTs) && (!Number.isFinite(existingTs) || nextTs > existingTs)) byKey.set(key, n);
  }

  return {
    schemaVersion: MEMORY_STATE_SCHEMA_VERSION,
    globalNotes: Array.from(byKey.values()).slice(0, 200),
  };
}

export async function upsertUserMemoryState(args: { userId: string; globalNotes: MemoryNote[] }): Promise<void> {
  const now = new Date().toISOString();

  // Normalize + bound payload size
  const nextNotes: MemoryNote[] = [];
  const seen = new Set<string>();
  for (const n of args.globalNotes) {
    const text = typeof n.text === "string" ? n.text.trim() : "";
    if (!text) continue;
    if (text.length > 400) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);

    nextNotes.push({
      text,
      keywords: Array.isArray(n.keywords) ? coerceKeywords(n.keywords) : [],
      createdAtISO: typeof n.createdAtISO === "string" && n.createdAtISO ? n.createdAtISO : now,
      // Intentionally allow expiresAtISO field to exist in storage (future-proof),
      // but we expect durable/global notes to omit it.
      ...(typeof n.expiresAtISO === "string" && n.expiresAtISO ? { expiresAtISO: n.expiresAtISO } : {}),
    });

    if (nextNotes.length >= 200) break;
  }

  await prisma.userMemoryState.upsert({
    where: { userId: args.userId },
    create: {
      userId: args.userId,
      schemaVersion: MEMORY_STATE_SCHEMA_VERSION,
      globalNotes: nextNotes as unknown as Prisma.InputJsonValue,
    },
    update: {
      schemaVersion: MEMORY_STATE_SCHEMA_VERSION,
      globalNotes: nextNotes as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}



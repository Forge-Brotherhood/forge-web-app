/**
 * Context Fetcher Helpers
 *
 * Shared helper functions for context fetchers.
 */

import type { ContextCandidate } from "./types";

const MAX_PREVIEW_LENGTH = 150;

/**
 * Calculate a recency score based on age.
 * Returns a score between 0.3 (oldest) and 1.0 (newest).
 */
export function calculateRecencyScore(date: Date): number {
  const now = Date.now();
  const ageMs = now - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Decay over 90 days
  if (ageDays < 1) return 1.0;
  if (ageDays < 7) return 0.9;
  if (ageDays < 30) return 0.7;
  if (ageDays < 90) return 0.5;
  return 0.3;
}

/**
 * Redact PII and truncate text for preview.
 */
export function createRedactedPreview(text: string): string {
  if (!text) return "";

  // Truncate to max length
  let preview =
    text.length > MAX_PREVIEW_LENGTH
      ? text.substring(0, MAX_PREVIEW_LENGTH) + "..."
      : text;

  // Basic PII redaction (emails, phone numbers)
  preview = preview.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "[EMAIL]"
  );
  preview = preview.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[PHONE]");

  return preview;
}

/**
 * Deduplicate candidates by ID, merging features on collision.
 * When duplicates exist, prefer the one with higher semanticScore,
 * then higher recencyScore.
 */
export function dedupeCandidates(
  candidates: ContextCandidate[]
): ContextCandidate[] {
  const byId = new Map<string, ContextCandidate>();

  const mergeFeatures = (
    current: ContextCandidate["features"] | undefined,
    incoming: ContextCandidate["features"] | undefined
  ): ContextCandidate["features"] | undefined => {
    if (!current) return incoming;
    if (!incoming) return current;
    return {
      ...current,
      ...incoming,
      semanticScore:
        typeof incoming.semanticScore === "number"
          ? Math.max(incoming.semanticScore ?? 0, current.semanticScore ?? 0)
          : current.semanticScore,
      recencyScore:
        typeof incoming.recencyScore === "number"
          ? Math.max(incoming.recencyScore ?? 0, current.recencyScore ?? 0)
          : current.recencyScore,
      temporalScore:
        typeof incoming.temporalScore === "number"
          ? Math.max(incoming.temporalScore ?? 0, current.temporalScore ?? 0)
          : current.temporalScore,
      scopeScore:
        typeof incoming.scopeScore === "number"
          ? Math.max(incoming.scopeScore ?? 0, current.scopeScore ?? 0)
          : current.scopeScore,
      createdAt: incoming.createdAt ?? current.createdAt,
    };
  };

  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }

    // Prefer candidate with higher semanticScore when available, else higher recencyScore.
    const existingSem = existing.features?.semanticScore ?? -1;
    const incomingSem = candidate.features?.semanticScore ?? -1;
    const existingRec = existing.features?.recencyScore ?? -1;
    const incomingRec = candidate.features?.recencyScore ?? -1;

    const shouldReplace =
      incomingSem > existingSem ||
      (incomingSem === existingSem && incomingRec > existingRec);

    if (shouldReplace) {
      byId.set(candidate.id, {
        ...candidate,
        features: mergeFeatures(existing.features, candidate.features),
      });
    } else {
      byId.set(existing.id, {
        ...existing,
        features: mergeFeatures(existing.features, candidate.features),
      });
    }
  }

  return Array.from(byId.values());
}

/**
 * Group candidates by source and count occurrences.
 */
export function groupBySource(
  candidates: ContextCandidate[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    counts[c.source] = (counts[c.source] || 0) + 1;
  }
  return counts;
}

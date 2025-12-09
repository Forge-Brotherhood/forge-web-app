/**
 * Explanation Cache Service
 *
 * Caches LLM-generated Bible explanations in KV store
 */

import {
  getKVClient,
  CacheKeys,
  CACHE_TTL_SECONDS,
  isCacheFresh,
} from '@/lib/kv';

// Types for explanation responses
export interface ExplanationFull {
  summary: string;
  historical_context: string;
  cross_references: Array<{ ref: string; note: string }>;
  disclaimer: string;
}

export interface ExplanationSummary {
  summary: string;
  disclaimer: string;
}

export interface ExplanationContext {
  historical_context: string;
  disclaimer: string;
}

export interface ExplanationReferences {
  cross_references: Array<{ ref: string; note: string }>;
}

export type ExplanationType = 'full' | 'summary' | 'context' | 'references';

type ExplanationData =
  | ExplanationFull
  | ExplanationSummary
  | ExplanationContext
  | ExplanationReferences;

/**
 * Get a cached explanation if available and fresh
 */
export async function getCachedExplanation<T extends ExplanationData>(
  reference: string,
  type: ExplanationType
): Promise<T | null> {
  const kv = getKVClient();
  const key = CacheKeys.explanation(reference, type);

  try {
    const cached = await kv.get<T>(key);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(`[KV Cache] HIT: explanation "${reference}" (${type})`);
      return cached.data;
    }
    console.log(`[KV Cache] MISS: explanation "${reference}" (${type})`);
    return null;
  } catch (error) {
    console.error(`[KV Cache] Error getting explanation "${reference}":`, error);
    return null;
  }
}

/**
 * Cache an explanation
 */
export async function cacheExplanation<T extends ExplanationData>(
  reference: string,
  type: ExplanationType,
  explanation: T
): Promise<void> {
  const kv = getKVClient();
  const key = CacheKeys.explanation(reference, type);

  try {
    await kv.set(key, explanation, CACHE_TTL_SECONDS);
    console.log(`[KV Cache] Cached explanation "${reference}" (${type})`);
  } catch (error) {
    console.error(`[KV Cache] Error caching explanation "${reference}":`, error);
    // Don't throw - caching failures shouldn't break the request
  }
}

/**
 * Delete a cached explanation (for cache invalidation)
 */
export async function deleteCachedExplanation(
  reference: string,
  type: ExplanationType
): Promise<void> {
  const kv = getKVClient();
  const key = CacheKeys.explanation(reference, type);

  try {
    await kv.delete(key);
    console.log(`[KV Cache] Deleted explanation "${reference}" (${type})`);
  } catch (error) {
    console.error(`[KV Cache] Error deleting explanation "${reference}":`, error);
  }
}

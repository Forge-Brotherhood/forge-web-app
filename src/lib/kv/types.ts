/**
 * KV Cache Types and Constants
 *
 * Defines the interface for cache operations and shared configuration
 */

export interface CachedValue<T> {
  data: T;
  lastRefreshedAt: number; // Unix timestamp in milliseconds
}

export interface KVClient {
  get<T>(key: string): Promise<CachedValue<T> | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// Cache TTL configuration
export const CACHE_TTL_DAYS = 30;
export const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 60 * 60; // 2,592,000 seconds

/**
 * Check if a cached value is still fresh based on lastRefreshedAt
 */
export function isCacheFresh(lastRefreshedAt: number): boolean {
  const ageMs = Date.now() - lastRefreshedAt;
  const maxAgeMs = CACHE_TTL_SECONDS * 1000;
  return ageMs < maxAgeMs;
}

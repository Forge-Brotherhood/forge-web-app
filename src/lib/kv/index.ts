/**
 * KV Cache Factory
 *
 * Provides the appropriate KV client based on environment:
 * - Development: Redis (ioredis)
 * - Production (Vercel): Vercel KV (Upstash)
 */

import type { KVClient } from './types';

// Re-export types and utilities
export * from './types';
export { CacheKeys } from './keys';

let kvClient: KVClient | null = null;

/**
 * Get the singleton KV client instance
 * Uses Redis in development, Vercel KV in production
 */
export function getKVClient(): KVClient {
  if (!kvClient) {
    if (process.env.VERCEL) {
      // Production: use Vercel KV
      // Dynamic import to avoid loading ioredis in production
      const { VercelKVClient } = require('./vercel');
      kvClient = new VercelKVClient();
      console.log('[KV] Using Vercel KV client');
    } else {
      // Development: use local Redis
      const { RedisClient } = require('./redis');
      kvClient = new RedisClient();
      console.log('[KV] Using Redis client');
    }
  }
  return kvClient!;
}

/**
 * Reset the KV client (useful for testing)
 */
export function resetKVClient(): void {
  kvClient = null;
}

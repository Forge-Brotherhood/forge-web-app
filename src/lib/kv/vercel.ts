/**
 * Vercel KV Client Implementation (Production)
 *
 * Uses @vercel/kv for Vercel's managed Redis (Upstash)
 */

import { kv } from '@vercel/kv';
import type { KVClient, CachedValue } from './types';

export class VercelKVClient implements KVClient {
  async get<T>(key: string): Promise<CachedValue<T> | null> {
    try {
      const result = await kv.get<CachedValue<T>>(key);
      return result ?? null;
    } catch (error) {
      console.error(`[Vercel KV] Error getting key "${key}":`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const wrapped: CachedValue<T> = {
        data: value,
        lastRefreshedAt: Date.now(),
      };

      if (ttlSeconds) {
        await kv.set(key, wrapped, { ex: ttlSeconds });
      } else {
        await kv.set(key, wrapped);
      }
    } catch (error) {
      console.error(`[Vercel KV] Error setting key "${key}":`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await kv.del(key);
    } catch (error) {
      console.error(`[Vercel KV] Error deleting key "${key}":`, error);
      throw error;
    }
  }
}

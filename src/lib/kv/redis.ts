/**
 * Redis Client Implementation (Development)
 *
 * Uses ioredis for local Redis connections during development
 */

import Redis from 'ioredis';
import type { KVClient, CachedValue } from './types';

export class RedisClient implements KVClient {
  private client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    this.client.on('connect', () => {
      if (process.env.KV_SILENT !== "1") console.log('[Redis] Connected to Redis');
    });
  }

  async get<T>(key: string): Promise<CachedValue<T> | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedValue<T>;
    } catch (error) {
      console.error(`[Redis] Error getting key "${key}":`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const wrapped: CachedValue<T> = {
        data: value,
        lastRefreshedAt: Date.now(),
      };
      const serialized = JSON.stringify(wrapped);

      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      console.error(`[Redis] Error setting key "${key}":`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error(`[Redis] Error deleting key "${key}":`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      // quit() can throw if already closed; fall back to disconnect.
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

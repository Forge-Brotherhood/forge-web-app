/**
 * Side Effects Wrapper
 *
 * Comprehensive wrapper for all mutation operations.
 * In debug mode, logs what WOULD happen but doesn't mutate.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { RunContext } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface MemoryData {
  memoryType: string;
  value: Prisma.InputJsonObject;
  strength?: number;
  source?: string;
}

export interface ConversationState {
  lastMessageAt?: Date;
  messageCount?: number;
  topicSummary?: string;
}

export interface AnalyticsEvent {
  type: string;
  properties: Record<string, unknown>;
}

// =============================================================================
// Side Effects Interface
// =============================================================================

export interface SideEffects {
  // Memory mutations
  writeMemory(userId: string, memory: MemoryData): Promise<void>;
  updateAccessStats(memoryIds: string[]): Promise<void>;

  // Cache mutations (stubbed - implement with Redis if needed)
  setCache(key: string, value: unknown, ttl?: number): Promise<void>;
  invalidateCache(pattern: string): Promise<void>;

  // User state mutations
  updateLastSeen(userId: string): Promise<void>;
  updateConversationState(
    userId: string,
    state: ConversationState
  ): Promise<void>;

  // Gamification mutations
  incrementStreak(userId: string): Promise<void>;
  awardBadge(userId: string, badge: string): Promise<void>;

  // Analytics
  logAnalytics(event: AnalyticsEvent): Promise<void>;
  incrementCounter(key: string): Promise<void>;
}

// =============================================================================
// No-Op Implementation (Debug Mode)
// =============================================================================

function createNoOpSideEffects(): SideEffects {
  const noOp =
    (name: string) =>
    async (...args: unknown[]) => {
      console.log(
        `[DEBUG] Blocked ${name}:`,
        JSON.stringify(args).slice(0, 200)
      );
    };

  return {
    writeMemory: noOp("writeMemory"),
    updateAccessStats: noOp("updateAccessStats"),
    setCache: noOp("setCache"),
    invalidateCache: noOp("invalidateCache"),
    updateLastSeen: noOp("updateLastSeen"),
    updateConversationState: noOp("updateConversationState"),
    incrementStreak: noOp("incrementStreak"),
    awardBadge: noOp("awardBadge"),
    logAnalytics: noOp("logAnalytics"),
    incrementCounter: noOp("incrementCounter"),
  };
}

// =============================================================================
// Production Implementation
// =============================================================================

function createProdSideEffects(): SideEffects {
  return {
    async writeMemory(userId: string, memory: MemoryData) {
      await prisma.userMemory.create({
        data: {
          userId,
          memoryType: memory.memoryType,
          value: memory.value,
          strength: memory.strength ?? 0.5,
          source: memory.source ?? "side_effect",
        },
      });
    },

    async updateAccessStats(memoryIds: string[]) {
      if (memoryIds.length === 0) return;
      await prisma.userMemory.updateMany({
        where: { id: { in: memoryIds } },
        data: {
          lastSeenAt: new Date(),
          occurrences: { increment: 1 },
        },
      });
    },

    async setCache(_key: string, _value: unknown, _ttl?: number) {
      // Implement with Redis if needed
      // For now, no-op in production as well
    },

    async invalidateCache(_pattern: string) {
      // Implement with Redis if needed
      // For now, no-op in production as well
    },

    async updateLastSeen(userId: string) {
      // User model uses updatedAt which auto-updates
      // Could also use lastPrayerAt for activity tracking
      console.log(`[SideEffects] Last seen update for ${userId}`);
    },

    async updateConversationState(userId: string, state: ConversationState) {
      // This would update conversation tracking if you have that table
      // For now, log it
      console.log(`[SideEffects] Conversation state for ${userId}:`, state);
    },

    async incrementStreak(userId: string) {
      // Implement streak logic if you have that feature
      console.log(`[SideEffects] Increment streak for ${userId}`);
    },

    async awardBadge(userId: string, badge: string) {
      // Implement badge awarding if you have that feature
      console.log(`[SideEffects] Award badge ${badge} to ${userId}`);
    },

    async logAnalytics(event: AnalyticsEvent) {
      // Log analytics event - for custom events, use console.log
      // The aiLogger.event expects specific AIEvent types
      console.log(`[Analytics] ${event.type}:`, event.properties);
    },

    async incrementCounter(key: string) {
      // Implement with Redis if needed
      console.log(`[SideEffects] Increment counter: ${key}`);
    },
  };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create side effects wrapper based on context mode.
 */
export function createSideEffects(ctx: RunContext): SideEffects {
  const isBlocked =
    ctx.sideEffects === "disabled" || ctx.writePolicy === "forbid";

  if (isBlocked) {
    return createNoOpSideEffects();
  }

  return createProdSideEffects();
}

// =============================================================================
// Guard Helpers
// =============================================================================

/**
 * Check if writes are allowed in the current context.
 * Throws if writes are forbidden.
 */
export function assertWriteAllowed(
  ctx: RunContext,
  operation: string
): void {
  if (ctx.writePolicy === "forbid") {
    throw new Error(`Write operation "${operation}" blocked in debug mode`);
  }
}

/**
 * Check if side effects are enabled.
 */
export function areSideEffectsEnabled(ctx: RunContext): boolean {
  return ctx.sideEffects === "enabled" && ctx.writePolicy === "allow";
}

/**
 * Wrap a side effect operation with logging.
 */
export async function withSideEffectLogging<T>(
  ctx: RunContext,
  operation: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (!areSideEffectsEnabled(ctx)) {
    console.log(`[SideEffects] Skipped ${operation} (disabled)`);
    return undefined;
  }

  try {
    const result = await fn();
    console.log(`[SideEffects] Completed ${operation}`);
    return result;
  } catch (error) {
    console.error(`[SideEffects] Failed ${operation}:`, error);
    throw error;
  }
}

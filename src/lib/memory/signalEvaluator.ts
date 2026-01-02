/**
 * Signal Evaluator Service
 *
 * Handles the signal → memory promotion logic.
 *
 * Signals are short-lived counters that track recurring patterns.
 * When a signal reaches the promotion threshold (2 sightings within TTL),
 * it gets promoted to a durable memory.
 *
 * Key behaviors:
 * - Prevents double-counting within the same conversation
 * - Refreshes TTL on each sighting
 * - Reinforces existing memories if pattern already established
 */

import { prisma } from "@/lib/prisma";
import { MEMORY_CONFIG, computeStrength } from "./vocabularies";
import type { MemoryCandidate } from "./candidateExtractor";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

export interface EvaluationResult {
  /** Number of new signals created */
  signalsCreated: number;
  /** Number of existing signals incremented */
  signalsIncremented: number;
  /** Number of signals promoted to memories */
  memoriesPromoted: number;
  /** Number of existing memories reinforced */
  memoriesReinforced: number;
  /** Details for debugging */
  details: EvaluationDetail[];
}

interface EvaluationDetail {
  candidateType: string;
  candidateValue: string;
  action: "created_signal" | "incremented_signal" | "promoted_to_memory" | "reinforced_memory" | "skipped_double_count";
}

// =============================================================================
// Public API
// =============================================================================

export interface EvaluateOptions {
  /** If true, simulate evaluation without database writes */
  dryRun?: boolean;
}

/**
 * Evaluate candidates and update signals/memories accordingly.
 *
 * @param userId - The user to update
 * @param conversationId - Current conversation (for double-count prevention)
 * @param candidates - Extracted memory candidates
 * @param options - Evaluation options (e.g., dryRun mode)
 * @returns Summary of actions taken
 */
export async function evaluateAndPromote(
  userId: string,
  conversationId: string,
  candidates: MemoryCandidate[],
  options: EvaluateOptions = {}
): Promise<EvaluationResult> {
  const { dryRun = false } = options;

  const result: EvaluationResult = {
    signalsCreated: 0,
    signalsIncremented: 0,
    memoriesPromoted: 0,
    memoriesReinforced: 0,
    details: [],
  };

  for (const candidate of candidates) {
    const detail = await processCandidate(userId, conversationId, candidate, dryRun);
    result.details.push(detail);

    switch (detail.action) {
      case "created_signal":
        result.signalsCreated++;
        break;
      case "incremented_signal":
        result.signalsIncremented++;
        break;
      case "promoted_to_memory":
        result.memoriesPromoted++;
        break;
      case "reinforced_memory":
        result.memoriesReinforced++;
        break;
    }
  }

  return result;
}

/**
 * Clean up expired signals (can be run as background job)
 */
export async function cleanupExpiredSignals(): Promise<number> {
  const result = await prisma.userSignal.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

// =============================================================================
// Internal Helpers
// =============================================================================

async function processCandidate(
  userId: string,
  conversationId: string,
  candidate: MemoryCandidate,
  dryRun: boolean = false
): Promise<EvaluationDetail> {
  const signalType = `${candidate.type}_signal`;
  const memoryType = candidate.type;
  const value = buildValueJson(candidate);

  // 1. Check if durable memory already exists
  const existingMemory = await prisma.userMemory.findFirst({
    where: {
      userId,
      memoryType,
      value: { equals: value },
      isActive: true,
    },
  });

  if (existingMemory) {
    // Reinforce existing memory (skip in dry run)
    if (!dryRun) {
      await reinforceMemory(existingMemory.id);
    }
    return {
      candidateType: candidate.type,
      candidateValue: String(candidate.value),
      action: "reinforced_memory",
    };
  }

  // 2. Check for existing signal
  const existingSignal = await prisma.userSignal.findFirst({
    where: {
      userId,
      signalType,
      value: { equals: value },
    },
  });

  // 3. Prevent double-counting within same conversation
  if (existingSignal?.lastCountedConversationId === conversationId) {
    return {
      candidateType: candidate.type,
      candidateValue: String(candidate.value),
      action: "skipped_double_count",
    };
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + MEMORY_CONFIG.SIGNAL_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  if (existingSignal) {
    // Simulate or perform increment
    const newCount = existingSignal.count + 1;

    if (!dryRun) {
      // Increment existing signal
      await prisma.userSignal.update({
        where: { id: existingSignal.id },
        data: {
          count: { increment: 1 },
          expiresAt, // Refresh TTL
          lastCountedConversationId: conversationId,
        },
      });
    }

    // Check for promotion threshold
    if (newCount >= MEMORY_CONFIG.PROMOTION_THRESHOLD) {
      if (!dryRun) {
        await promoteToMemory(userId, candidate, newCount);
        await prisma.userSignal.delete({ where: { id: existingSignal.id } });
      }

      return {
        candidateType: candidate.type,
        candidateValue: String(candidate.value),
        action: "promoted_to_memory",
      };
    }

    return {
      candidateType: candidate.type,
      candidateValue: String(candidate.value),
      action: "incremented_signal",
    };
  }

  // 4. Create new signal (skip in dry run)
  if (!dryRun) {
    await prisma.userSignal.create({
      data: {
        userId,
        signalType,
        value,
        count: 1,
        expiresAt,
        lastCountedConversationId: conversationId,
      },
    });
  }

  return {
    candidateType: candidate.type,
    candidateValue: String(candidate.value),
    action: "created_signal",
  };
}

function buildValueJson(candidate: MemoryCandidate): Prisma.InputJsonObject {
  switch (candidate.type) {
    case "struggle_theme":
      return { theme: candidate.value };
    case "faith_stage":
      return { stage: candidate.value };
    default: {
      const exhaustiveCheck: never = candidate;
      throw new Error(`Unhandled MemoryCandidate type: ${String(exhaustiveCheck)}`);
    }
  }
}

async function reinforceMemory(memoryId: string): Promise<void> {
  const memory = await prisma.userMemory.findUnique({
    where: { id: memoryId },
  });

  if (!memory) return;

  const newOccurrences = memory.occurrences + 1;
  const newStrength = computeStrengthFromOccurrences(newOccurrences);

  await prisma.userMemory.update({
    where: { id: memoryId },
    data: {
      occurrences: newOccurrences,
      strength: newStrength,
      lastSeenAt: new Date(),
    },
  });
}

async function promoteToMemory(
  userId: string,
  candidate: MemoryCandidate,
  occurrences: number
): Promise<void> {
  const value = buildValueJson(candidate);
  const strength = computeStrengthFromOccurrences(occurrences);

  await prisma.userMemory.create({
    data: {
      userId,
      memoryType: candidate.type,
      value,
      strength,
      occurrences,
      source: "signal_promotion",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      isActive: true,
    },
  });

  console.log(
    `[SignalEvaluator] Promoted ${candidate.type}:${candidate.value} to memory for user ${userId}`
  );
}

function computeStrengthFromOccurrences(occurrences: number): number {
  const strength = computeStrength(occurrences);
  switch (strength) {
    case "light":
      return 0.4;
    case "moderate":
      return 0.7;
    case "strong":
      return 1.0;
  }
}

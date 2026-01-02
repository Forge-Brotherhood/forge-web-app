/**
 * Pipeline Artifact Persistence
 *
 * Stores and retrieves pipeline artifacts.
 * Artifacts contain only redacted data - raw content goes to vault.
 */

import { prisma } from "@/lib/prisma";
import { PipelineStage, type RunContext, type StageArtifact } from "./types";

// =============================================================================
// Artifact Persistence
// =============================================================================

/**
 * Persist a stage artifact to the database.
 */
export async function persistArtifact(
  ctx: RunContext,
  artifact: StageArtifact
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (ctx.mode === "debug" ? 7 : 30));

  try {
    await prisma.pipelineArtifact.upsert({
      where: {
        runId_stage: {
          runId: ctx.runId,
          stage: artifact.stage,
        },
      },
      create: {
        runId: ctx.runId,
        traceId: ctx.traceId,
        userId: ctx.userId,
        stage: artifact.stage,
        schemaVersion: artifact.schemaVersion,
        pipelineVersion: artifact.pipelineVersion,
        summary: artifact.summary,
        payload: artifact.payload as object,
        rawRef: artifact.rawRef,
        stats: artifact.stats,
        durationMs: artifact.durationMs,
        createdAt: new Date(artifact.createdAt),
        expiresAt,
      },
      update: {
        summary: artifact.summary,
        payload: artifact.payload as object,
        rawRef: artifact.rawRef,
        stats: artifact.stats,
        durationMs: artifact.durationMs,
      },
    });
  } catch (error) {
    // Log but don't fail the pipeline for persistence errors
    console.error("[Pipeline] Failed to persist artifact:", error);
  }
}

/**
 * Retrieve all artifacts for a run.
 */
export async function getArtifacts(runId: string): Promise<StageArtifact[]> {
  const records = await prisma.pipelineArtifact.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });

  return records.map((record) => ({
    traceId: record.traceId,
    runId: record.runId,
    stage: record.stage as PipelineStage,
    schemaVersion: record.schemaVersion,
    pipelineVersion: record.pipelineVersion,
    createdAt: record.createdAt.toISOString(),
    durationMs: record.durationMs,
    summary: record.summary,
    payload: record.payload,
    rawRef: record.rawRef ?? undefined,
    stats: record.stats as Record<string, number>,
  }));
}

/**
 * Retrieve a specific artifact by run and stage.
 */
export async function getArtifact(
  runId: string,
  stage: PipelineStage
): Promise<StageArtifact | null> {
  const record = await prisma.pipelineArtifact.findUnique({
    where: {
      runId_stage: { runId, stage },
    },
  });

  if (!record) return null;

  return {
    traceId: record.traceId,
    runId: record.runId,
    stage: record.stage as PipelineStage,
    schemaVersion: record.schemaVersion,
    pipelineVersion: record.pipelineVersion,
    createdAt: record.createdAt.toISOString(),
    durationMs: record.durationMs,
    summary: record.summary,
    payload: record.payload,
    rawRef: record.rawRef ?? undefined,
    stats: record.stats as Record<string, number>,
  };
}

/**
 * Delete artifacts for a run.
 */
export async function deleteArtifacts(runId: string): Promise<void> {
  await prisma.pipelineArtifact.deleteMany({
    where: { runId },
  });
}

/**
 * Clean up expired artifacts.
 */
export async function cleanupExpiredArtifacts(): Promise<number> {
  const result = await prisma.pipelineArtifact.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

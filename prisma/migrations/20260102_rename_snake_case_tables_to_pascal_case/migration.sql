-- Standardize table naming across environments by using Prisma's default table naming
-- (model name, quoted), instead of a mix of @@map("snake_case") and unmapped models.
--
-- This migration renames the previously snake_case tables to their corresponding
-- Prisma model names (PascalCase).
--
-- Postgres keeps constraints and foreign keys intact on table rename.

ALTER TABLE IF EXISTS "bible_reading_progress" RENAME TO "BibleReadingProgress";
ALTER TABLE IF EXISTS "bible_reading_session" RENAME TO "BibleReadingSession";

ALTER TABLE IF EXISTS "user_preferences" RENAME TO "UserPreferences";
ALTER TABLE IF EXISTS "conversation_state" RENAME TO "ConversationState";
ALTER TABLE IF EXISTS "user_memory" RENAME TO "UserMemory";
ALTER TABLE IF EXISTS "user_signal" RENAME TO "UserSignal";
ALTER TABLE IF EXISTS "user_life_context" RENAME TO "UserLifeContext";

ALTER TABLE IF EXISTS "artifact" RENAME TO "Artifact";
ALTER TABLE IF EXISTS "artifact_edge" RENAME TO "ArtifactEdge";
ALTER TABLE IF EXISTS "artifact_embedding" RENAME TO "ArtifactEmbedding";

ALTER TABLE IF EXISTS "pipeline_artifact" RENAME TO "PipelineArtifact";
ALTER TABLE IF EXISTS "pipeline_vault" RENAME TO "PipelineVault";
ALTER TABLE IF EXISTS "debug_run" RENAME TO "DebugRun";



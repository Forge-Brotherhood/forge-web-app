-- Standardize table naming across environments by using Prisma's default table naming
-- (model name, quoted), instead of a mix of @@map("snake_case") and unmapped models.
--
-- This migration renames the previously snake_case tables to their corresponding
-- Prisma model names (PascalCase).
--
-- Postgres keeps constraints and foreign keys intact on table rename.

ALTER TABLE "bible_reading_progress" RENAME TO "BibleReadingProgress";
ALTER TABLE "bible_reading_session" RENAME TO "BibleReadingSession";

ALTER TABLE "user_preferences" RENAME TO "UserPreferences";
ALTER TABLE "conversation_state" RENAME TO "ConversationState";
ALTER TABLE "user_memory" RENAME TO "UserMemory";
ALTER TABLE "user_signal" RENAME TO "UserSignal";
ALTER TABLE "user_life_context" RENAME TO "UserLifeContext";

ALTER TABLE "artifact" RENAME TO "Artifact";
ALTER TABLE "artifact_edge" RENAME TO "ArtifactEdge";
ALTER TABLE "artifact_embedding" RENAME TO "ArtifactEmbedding";

ALTER TABLE "pipeline_artifact" RENAME TO "PipelineArtifact";
ALTER TABLE "pipeline_vault" RENAME TO "PipelineVault";
ALTER TABLE "debug_run" RENAME TO "DebugRun";



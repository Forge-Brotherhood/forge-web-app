-- Retire reading plans (Phase 3 of the goals plan).
--
-- WARNING: THIS MIGRATION PERMANENTLY DELETES USER DATA (every plan template, enrolment, completed
-- day and generated audio record) and cannot be undone. Nothing is converted to goals. It must only
-- be run once the user has approved it, after the apps that call the reading-plan routes are retired.
--
-- Order: children first, so no foreign key is ever left dangling. The tables are dropped without
-- CASCADE on purpose: if anything unexpected still references them, this fails instead of silently
-- dropping that too. IF EXISTS keeps it safe on databases that never had them (the plan tables were
-- created before this migration history started). No extension is dropped: the embedding table
-- stored a BYTEA column, not a pgvector type, and no migration here creates the pgvector extension.

-- DropTable
DROP TABLE IF EXISTS "ReadingPlanProgress";
DROP TABLE IF EXISTS "ReadingPlanDayAudio";
DROP TABLE IF EXISTS "ReadingPlanTemplateEmbedding";
DROP TABLE IF EXISTS "UserReadingPlan";
DROP TABLE IF EXISTS "ReadingPlanTemplateDay";
DROP TABLE IF EXISTS "ReadingPlanTemplate";

-- DropEnum
DROP TYPE IF EXISTS "UserReadingPlanStatus";
DROP TYPE IF EXISTS "ReadingPlanVisibility";

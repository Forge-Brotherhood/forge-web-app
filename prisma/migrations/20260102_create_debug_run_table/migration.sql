-- Create DebugRun table for AI Debugger runs (and a compatibility view for older clients).
-- This repo previously had a rename migration that assumes an existing snake_case `debug_run`.
-- In fresh databases, that table won't exist, so we create the canonical `"DebugRun"` table here.

DO $$ BEGIN
  CREATE TYPE "DebugRunStatus" AS ENUM ('pending', 'running', 'stopped', 'completed', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DebugRun" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "impersonatedUserId" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityRefs" JSONB,
  "status" "DebugRunStatus" NOT NULL DEFAULT 'pending',
  "stoppedAtStage" TEXT,
  "errorMessage" TEXT,
  "settings" JSONB NOT NULL,
  "parentRunId" TEXT,
  "conversationHistory" JSONB,
  "lastAssistantMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DebugRun_pkey" PRIMARY KEY ("id")
);

-- Uniques (match Prisma @unique)
CREATE UNIQUE INDEX IF NOT EXISTS "DebugRun_runId_key" ON "DebugRun" ("runId");
CREATE UNIQUE INDEX IF NOT EXISTS "DebugRun_traceId_key" ON "DebugRun" ("traceId");

-- Indexes (match Prisma @@index)
CREATE INDEX IF NOT EXISTS "DebugRun_adminId_createdAt_idx" ON "DebugRun" ("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "DebugRun_runId_idx" ON "DebugRun" ("runId");
CREATE INDEX IF NOT EXISTS "DebugRun_parentRunId_idx" ON "DebugRun" ("parentRunId");

-- Foreign keys (created conditionally to keep the migration idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_adminId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_adminId_fkey"
      FOREIGN KEY ("adminId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_impersonatedUserId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_impersonatedUserId_fkey"
      FOREIGN KEY ("impersonatedUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_parentRunId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_parentRunId_fkey"
      FOREIGN KEY ("parentRunId") REFERENCES "DebugRun"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Compatibility for older Prisma clients that still query the legacy snake_case `debug_run`.
-- If `debug_run` already exists as a table/view, we leave it alone.
DO $$ BEGIN
  IF to_regclass('public.debug_run') IS NULL THEN
    EXECUTE 'CREATE VIEW debug_run AS SELECT * FROM "DebugRun"';
  END IF;
END $$;

-- Create DebugRun table for AI Debugger runs (and a compatibility view for older clients).
-- This repo previously had a rename migration that assumes an existing snake_case `debug_run`.
-- In fresh databases, that table won't exist, so we create the canonical `"DebugRun"` table here.

DO $$ BEGIN
  CREATE TYPE "DebugRunStatus" AS ENUM ('pending', 'running', 'stopped', 'completed', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DebugRun" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "impersonatedUserId" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityRefs" JSONB,
  "status" "DebugRunStatus" NOT NULL DEFAULT 'pending',
  "stoppedAtStage" TEXT,
  "errorMessage" TEXT,
  "settings" JSONB NOT NULL,
  "parentRunId" TEXT,
  "conversationHistory" JSONB,
  "lastAssistantMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DebugRun_pkey" PRIMARY KEY ("id")
);

-- Uniques (match Prisma @unique)
CREATE UNIQUE INDEX IF NOT EXISTS "DebugRun_runId_key" ON "DebugRun" ("runId");
CREATE UNIQUE INDEX IF NOT EXISTS "DebugRun_traceId_key" ON "DebugRun" ("traceId");

-- Indexes (match Prisma @@index)
CREATE INDEX IF NOT EXISTS "DebugRun_adminId_createdAt_idx" ON "DebugRun" ("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "DebugRun_runId_idx" ON "DebugRun" ("runId");
CREATE INDEX IF NOT EXISTS "DebugRun_parentRunId_idx" ON "DebugRun" ("parentRunId");

-- Foreign keys (created conditionally to keep the migration idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_adminId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_adminId_fkey"
      FOREIGN KEY ("adminId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_impersonatedUserId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_impersonatedUserId_fkey"
      FOREIGN KEY ("impersonatedUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DebugRun_parentRunId_fkey'
  ) THEN
    ALTER TABLE "DebugRun"
      ADD CONSTRAINT "DebugRun_parentRunId_fkey"
      FOREIGN KEY ("parentRunId") REFERENCES "DebugRun"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Compatibility for older Prisma clients that still query the legacy snake_case `debug_run`.
-- If `debug_run` already exists as a table/view, we leave it alone.
DO $$ BEGIN
  IF to_regclass('public.debug_run') IS NULL THEN
    EXECUTE 'CREATE VIEW debug_run AS SELECT * FROM "DebugRun"';
  END IF;
END $$;



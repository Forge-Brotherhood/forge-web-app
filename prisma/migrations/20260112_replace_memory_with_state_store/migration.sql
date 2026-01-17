-- Replace legacy signals→memory tables (UserMemory, UserSignal) with a state-based store (UserMemoryState).
-- Starting fresh: no data migration.

-- Drop legacy tables (order matters due to FKs)
DROP TABLE IF EXISTS "UserSignal";
DROP TABLE IF EXISTS "UserMemory";

-- Create new state-based memory table
CREATE TABLE IF NOT EXISTS "UserMemoryState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'forge.user_memory_state.v1',
  "globalNotes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserMemoryState_pkey" PRIMARY KEY ("id")
);

-- Uniqueness per-user
CREATE UNIQUE INDEX IF NOT EXISTS "UserMemoryState_userId_key" ON "UserMemoryState"("userId");

-- Foreign key to User
ALTER TABLE "UserMemoryState"
  DROP CONSTRAINT IF EXISTS "UserMemoryState_userId_fkey";

ALTER TABLE "UserMemoryState"
  ADD CONSTRAINT "UserMemoryState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for user lookups
CREATE INDEX IF NOT EXISTS "UserMemoryState_userId_idx" ON "UserMemoryState"("userId");



-- Add missing Bible reading context fields used by Prisma client.
-- These columns are already present in `prisma/schema.prisma`, but may be missing in existing databases
-- if they were previously updated via `prisma db push` or manual SQL.

-- BibleReadingProgress: contextType/contextSourceId
ALTER TABLE IF EXISTS "BibleReadingProgress"
  ADD COLUMN IF NOT EXISTS "contextType" TEXT NOT NULL DEFAULT 'standalone';

ALTER TABLE IF EXISTS "BibleReadingProgress"
  ADD COLUMN IF NOT EXISTS "contextSourceId" TEXT;

-- BibleReadingSession: contextType/contextSourceId/entryPoint
ALTER TABLE IF EXISTS "BibleReadingSession"
  ADD COLUMN IF NOT EXISTS "contextType" TEXT NOT NULL DEFAULT 'standalone';

ALTER TABLE IF EXISTS "BibleReadingSession"
  ADD COLUMN IF NOT EXISTS "contextSourceId" TEXT;

ALTER TABLE IF EXISTS "BibleReadingSession"
  ADD COLUMN IF NOT EXISTS "entryPoint" TEXT;


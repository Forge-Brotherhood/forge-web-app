-- Regions on guide maps: a place is either a point or a region with an outline.
ALTER TABLE "BiblePlace" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'point';
ALTER TABLE "BiblePlace" ADD COLUMN IF NOT EXISTS "boundary" JSONB;

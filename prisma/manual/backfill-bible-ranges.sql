-- Backfill + schema bridge for BibleHighlight / VerseNote range columns.
--
-- Why this exists:
-- - Production has existing rows created under the legacy "verseId" model (BOOK_CHAPTER_VERSE).
-- - Prisma `db push` cannot add required columns without defaults when data exists.
-- - This script adds the new required columns with safe defaults, backfills from verseId,
--   then drops the defaults to avoid silent bad writes going forward.
--
-- Safe to run multiple times (uses IF NOT EXISTS + idempotent updates).

BEGIN;

-- =============================================================================
-- VerseNote: add range fields and backfill from legacy verseId (BOOK_CHAPTER_VERSE)
-- =============================================================================

ALTER TABLE "VerseNote"
ADD COLUMN IF NOT EXISTS "bookId" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "chapter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseStart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseEnd" INTEGER NOT NULL DEFAULT 0;

UPDATE "VerseNote"
SET
  "bookId" = split_part("verseId", '_', 1),
  "chapter" = NULLIF(split_part("verseId", '_', 2), '')::INTEGER,
  "verseStart" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER,
  "verseEnd" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER
WHERE
  ("bookId" = '' OR "chapter" = 0 OR "verseStart" = 0 OR "verseEnd" = 0)
  AND "verseId" LIKE '%_%_%';

ALTER TABLE "VerseNote"
ALTER COLUMN "bookId" DROP DEFAULT,
ALTER COLUMN "chapter" DROP DEFAULT,
ALTER COLUMN "verseStart" DROP DEFAULT,
ALTER COLUMN "verseEnd" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "VerseNote_bookId_chapter_idx"
ON "VerseNote" ("bookId", "chapter");

CREATE INDEX IF NOT EXISTS "VerseNote_userId_bookId_chapter_idx"
ON "VerseNote" ("userId", "bookId", "chapter");

-- =============================================================================
-- BibleHighlight: add range fields and backfill from legacy verseId (BOOK_CHAPTER_VERSE)
-- =============================================================================

-- Some environments may already have bibleVersion; this keeps it stable and non-null.
ALTER TABLE "BibleHighlight"
ADD COLUMN IF NOT EXISTS "bibleVersion" TEXT NOT NULL DEFAULT 'BSB',
ADD COLUMN IF NOT EXISTS "bookId" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "chapter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseStart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseEnd" INTEGER NOT NULL DEFAULT 0;

-- If legacy "verseId" exists, backfill from it. (If it doesn't, this will no-op via WHERE.)
UPDATE "BibleHighlight"
SET
  "bookId" = split_part("verseId", '_', 1),
  "chapter" = NULLIF(split_part("verseId", '_', 2), '')::INTEGER,
  "verseStart" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER,
  "verseEnd" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER
WHERE
  ("bookId" = '' OR "chapter" = 0 OR "verseStart" = 0 OR "verseEnd" = 0)
  AND "verseId" LIKE '%_%_%';

ALTER TABLE "BibleHighlight"
ALTER COLUMN "bibleVersion" DROP DEFAULT,
ALTER COLUMN "bookId" DROP DEFAULT,
ALTER COLUMN "chapter" DROP DEFAULT,
ALTER COLUMN "verseStart" DROP DEFAULT,
ALTER COLUMN "verseEnd" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "BibleHighlight_userId_bookId_chapter_idx"
ON "BibleHighlight" ("userId", "bookId", "chapter");

COMMIT;



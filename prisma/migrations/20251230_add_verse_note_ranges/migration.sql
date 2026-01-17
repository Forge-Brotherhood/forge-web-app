-- Add range fields to VerseNote to support single or contiguous in-chapter notes.
-- Backfill existing rows from legacy verseId (BOOK_CHAPTER_VERSE).

-- NOTE: This migration must be resilient when applied to an empty/shadow database.
-- Some environments may not have the VerseNote table yet during shadow migration validation.
ALTER TABLE IF EXISTS "VerseNote"
ADD COLUMN IF NOT EXISTS "bookId" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "chapter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseStart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "verseEnd" INTEGER NOT NULL DEFAULT 0;

-- Backfill from verseId for existing notes
DO $$
BEGIN
  IF to_regclass('"VerseNote"') IS NOT NULL THEN
    UPDATE "VerseNote"
    SET
      "bookId" = split_part("verseId", '_', 1),
      "chapter" = NULLIF(split_part("verseId", '_', 2), '')::INTEGER,
      "verseStart" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER,
      "verseEnd" = NULLIF(split_part("verseId", '_', 3), '')::INTEGER
    WHERE
      ("bookId" = '' OR "chapter" = 0 OR "verseStart" = 0 OR "verseEnd" = 0)
      AND "verseId" LIKE '%_%_%';
  END IF;
END $$;

-- Optional: remove defaults (kept harmless if left in place; remove to avoid silent bad writes)
DO $$
BEGIN
  IF to_regclass('"VerseNote"') IS NOT NULL THEN
    ALTER TABLE "VerseNote"
    ALTER COLUMN "bookId" DROP DEFAULT,
    ALTER COLUMN "chapter" DROP DEFAULT,
    ALTER COLUMN "verseStart" DROP DEFAULT,
    ALTER COLUMN "verseEnd" DROP DEFAULT;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"VerseNote"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "VerseNote_bookId_chapter_idx"
    ON "VerseNote" ("bookId", "chapter");

    CREATE INDEX IF NOT EXISTS "VerseNote_userId_bookId_chapter_idx"
    ON "VerseNote" ("userId", "bookId", "chapter");
  END IF;
END $$;



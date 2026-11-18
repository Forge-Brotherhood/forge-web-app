-- Bible places for guide maps (OpenBible.info Bible Geocoding Data, CC BY 4.0).

CREATE TABLE IF NOT EXISTS "BiblePlace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "types" TEXT[],
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "confidence" INTEGER NOT NULL,
    "modernName" TEXT,
    "coordSource" TEXT,
    CONSTRAINT "BiblePlace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiblePlace_slug_key" ON "BiblePlace"("slug");

CREATE TABLE IF NOT EXISTS "BiblePlaceRef" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    CONSTRAINT "BiblePlaceRef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BiblePlaceRef_placeId_bookId_chapter_verse_key" ON "BiblePlaceRef"("placeId", "bookId", "chapter", "verse");
CREATE INDEX IF NOT EXISTS "BiblePlaceRef_bookId_chapter_idx" ON "BiblePlaceRef"("bookId", "chapter");

DO $$ BEGIN
  ALTER TABLE "BiblePlaceRef" ADD CONSTRAINT "BiblePlaceRef_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "BiblePlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

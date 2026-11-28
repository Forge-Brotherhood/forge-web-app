-- Curated journeys for guide maps (BibleRoute, BibleRouteStop).
-- CreateTable
CREATE TABLE "BibleRoute" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "certainty" TEXT NOT NULL,
    "passage" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapterStart" INTEGER NOT NULL,
    "chapterEnd" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BibleRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibleRouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "placeId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "by" TEXT NOT NULL DEFAULT 'road',
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "waypoints" JSONB,
    "note" TEXT,

    CONSTRAINT "BibleRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BibleRoute_slug_key" ON "BibleRoute"("slug");

-- CreateIndex
CREATE INDEX "BibleRoute_bookId_chapterStart_idx" ON "BibleRoute"("bookId", "chapterStart");

-- CreateIndex
CREATE INDEX "BibleRouteStop_placeId_idx" ON "BibleRouteStop"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "BibleRouteStop_routeId_order_key" ON "BibleRouteStop"("routeId", "order");

-- AddForeignKey
ALTER TABLE "BibleRouteStop" ADD CONSTRAINT "BibleRouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "BibleRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibleRouteStop" ADD CONSTRAINT "BibleRouteStop_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "BiblePlace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


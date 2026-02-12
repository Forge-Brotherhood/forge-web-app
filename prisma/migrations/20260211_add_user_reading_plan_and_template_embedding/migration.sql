-- Create UserReadingPlan, ReadingPlanTemplateEmbedding tables.
-- Rename groupPlanId → userPlanId on 4 related tables.
-- All groupPlanId columns are empty in prod, so this is non-destructive.

-- 1. Create enum
CREATE TYPE "UserReadingPlanStatus" AS ENUM ('scheduled', 'active', 'paused', 'completed', 'canceled');

-- 2. Create UserReadingPlan table
CREATE TABLE "UserReadingPlan" (
    "id" TEXT NOT NULL,
    "shortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "UserReadingPlanStatus" NOT NULL DEFAULT 'scheduled',
    "notifyDaily" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserReadingPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserReadingPlan_shortId_key" ON "UserReadingPlan"("shortId");
CREATE INDEX "UserReadingPlan_userId_status_idx" ON "UserReadingPlan"("userId", "status");
CREATE INDEX "UserReadingPlan_templateId_idx" ON "UserReadingPlan"("templateId");
CREATE INDEX "UserReadingPlan_startDate_idx" ON "UserReadingPlan"("startDate");

ALTER TABLE "UserReadingPlan"
    ADD CONSTRAINT "UserReadingPlan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserReadingPlan"
    ADD CONSTRAINT "UserReadingPlan_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ReadingPlanTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Create ReadingPlanTemplateEmbedding table
CREATE TABLE "ReadingPlanTemplateEmbedding" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingPlanTemplateEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReadingPlanTemplateEmbedding_templateId_model_key" ON "ReadingPlanTemplateEmbedding"("templateId", "model");
CREATE INDEX "ReadingPlanTemplateEmbedding_model_idx" ON "ReadingPlanTemplateEmbedding"("model");

ALTER TABLE "ReadingPlanTemplateEmbedding"
    ADD CONSTRAINT "ReadingPlanTemplateEmbedding_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ReadingPlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Rename groupPlanId → userPlanId on BibleHighlight
ALTER TABLE "BibleHighlight" DROP CONSTRAINT "BibleHighlight_groupPlanId_fkey";
DROP INDEX "BibleHighlight_groupPlanId_templateDayId_idx";
ALTER TABLE "BibleHighlight" RENAME COLUMN "groupPlanId" TO "userPlanId";
CREATE INDEX "BibleHighlight_userPlanId_templateDayId_idx" ON "BibleHighlight"("userPlanId", "templateDayId");
ALTER TABLE "BibleHighlight"
    ADD CONSTRAINT "BibleHighlight_userPlanId_fkey"
    FOREIGN KEY ("userPlanId") REFERENCES "UserReadingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Rename groupPlanId → userPlanId on VerseNote
ALTER TABLE "VerseNote" DROP CONSTRAINT "VerseNote_groupPlanId_fkey";
DROP INDEX "VerseNote_groupPlanId_templateDayId_idx";
ALTER TABLE "VerseNote" RENAME COLUMN "groupPlanId" TO "userPlanId";
CREATE INDEX "VerseNote_userPlanId_templateDayId_idx" ON "VerseNote"("userPlanId", "templateDayId");
ALTER TABLE "VerseNote"
    ADD CONSTRAINT "VerseNote_userPlanId_fkey"
    FOREIGN KEY ("userPlanId") REFERENCES "UserReadingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Rename groupPlanId → userPlanId on ReadingPlanProgress
ALTER TABLE "ReadingPlanProgress" DROP CONSTRAINT "ReadingPlanProgress_groupPlanId_fkey";
DROP INDEX "ReadingPlanProgress_groupPlanId_templateDayId_idx";
DROP INDEX "ReadingPlanProgress_groupPlanId_templateDayId_userId_key";
ALTER TABLE "ReadingPlanProgress" RENAME COLUMN "groupPlanId" TO "userPlanId";
CREATE INDEX "ReadingPlanProgress_userPlanId_templateDayId_idx" ON "ReadingPlanProgress"("userPlanId", "templateDayId");
CREATE UNIQUE INDEX "ReadingPlanProgress_userPlanId_templateDayId_userId_key" ON "ReadingPlanProgress"("userPlanId", "templateDayId", "userId");
ALTER TABLE "ReadingPlanProgress"
    ADD CONSTRAINT "ReadingPlanProgress_userPlanId_fkey"
    FOREIGN KEY ("userPlanId") REFERENCES "UserReadingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Rename groupPlanId → userPlanId on ReadingPlanReflection
ALTER TABLE "ReadingPlanReflection" DROP CONSTRAINT "ReadingPlanReflection_groupPlanId_fkey";
DROP INDEX "ReadingPlanReflection_groupPlanId_templateDayId_idx";
ALTER TABLE "ReadingPlanReflection" RENAME COLUMN "groupPlanId" TO "userPlanId";
CREATE INDEX "ReadingPlanReflection_userPlanId_templateDayId_idx" ON "ReadingPlanReflection"("userPlanId", "templateDayId");
ALTER TABLE "ReadingPlanReflection"
    ADD CONSTRAINT "ReadingPlanReflection_userPlanId_fkey"
    FOREIGN KEY ("userPlanId") REFERENCES "UserReadingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "suiteVersion" TEXT NOT NULL,
    "label" TEXT,
    "caseIds" TEXT[],
    "repeats" INTEGER NOT NULL,
    "estimatedUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "repeat" INTEGER NOT NULL,
    "output" TEXT NOT NULL,
    "raw" JSONB,
    "checks" JSONB NOT NULL,
    "grade" JSONB,
    "passed" BOOLEAN NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvalRun_suiteId_createdAt_idx" ON "EvalRun"("suiteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResult_runId_caseId_repeat_key" ON "EvalResult"("runId", "caseId", "repeat");

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

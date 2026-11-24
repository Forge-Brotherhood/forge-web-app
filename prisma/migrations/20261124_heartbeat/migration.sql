-- Server heartbeat (Phase 4 of the goals plan). NOT APPLIED to any database yet.
--
-- None of these tables holds readable content. "ciphertext" is AES-256-GCM under a brief key made
-- on the user's device, and the only copy of that key the server keeps is "HeartbeatGrant"."wrappedKey",
-- wrapped by AWS KMS and deleted when the grant lapses or is revoked. The rest is metadata: ids, times,
-- flags, counts and outcome codes. Every table cascades with the user.

-- CreateTable
CREATE TABLE "HeartbeatState" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "quietStart" TEXT NOT NULL,
    "quietEnd" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nextBeatAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3),
    "claimedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeartbeatState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "HeartbeatBrief" (
    "userId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "deviceWrittenAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeartbeatBrief_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "HeartbeatGrant" (
    "userId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeartbeatGrant_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "HeartbeatOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "staleness" TEXT,
    "modelCalled" BOOLEAN NOT NULL DEFAULT false,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "activities" INTEGER NOT NULL DEFAULT 0,
    "dropped" INTEGER NOT NULL DEFAULT 0,
    "pushed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeartbeatState_enabled_nextBeatAt_idx" ON "HeartbeatState"("enabled", "nextBeatAt");

-- CreateIndex
CREATE INDEX "HeartbeatBrief_deviceWrittenAt_idx" ON "HeartbeatBrief"("deviceWrittenAt");

-- CreateIndex
CREATE INDEX "HeartbeatGrant_expiresAt_idx" ON "HeartbeatGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "HeartbeatOutbox_userId_createdAt_idx" ON "HeartbeatOutbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_createdAt_idx" ON "HeartbeatRun"("createdAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_userId_createdAt_idx" ON "HeartbeatRun"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HeartbeatState" ADD CONSTRAINT "HeartbeatState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatBrief" ADD CONSTRAINT "HeartbeatBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatGrant" ADD CONSTRAINT "HeartbeatGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatOutbox" ADD CONSTRAINT "HeartbeatOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRun" ADD CONSTRAINT "HeartbeatRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

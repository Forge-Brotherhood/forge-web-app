-- AlterTable
ALTER TABLE "HeartbeatState" ADD COLUMN "lastHeadsUpDay" TEXT;

-- AlterTable
ALTER TABLE "HeartbeatBrief" ADD COLUMN "receivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HeartbeatState" ADD COLUMN     "pausedUntil" TIMESTAMP(3),
ADD COLUMN     "sendTimes" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[];

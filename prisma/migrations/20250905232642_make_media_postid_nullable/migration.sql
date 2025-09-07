-- AlterTable
ALTER TABLE "public"."Media" ALTER COLUMN "postId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Media_url_idx" ON "public"."Media"("url");

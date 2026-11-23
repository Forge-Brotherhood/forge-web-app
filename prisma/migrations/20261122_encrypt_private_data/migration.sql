-- Private content moves off the server. These tables held it in readable form; it is now
-- encrypted on the user's device and stored only as ciphertext in "VaultRecord".
-- Nothing is migrated: the old tables are dropped with their data.
--
-- Written to run on a database whose exact shape may differ from a developer's (constraint
-- names, tables already removed): every drop is IF EXISTS, and CASCADE takes the foreign keys.

-- Conversations were also stored at OpenAI, and these tables hold the only record of their ids.
-- Keep the ids so the conversations can still be deleted there once the tables are gone:
-- scripts/purge-openai-conversations.ts deletes each one at OpenAI and then drops this table.
CREATE TABLE IF NOT EXISTS "_OpenAIConversationToDelete" ("id" TEXT PRIMARY KEY);

DO $$
DECLARE
  source TEXT;
BEGIN
  FOREACH source IN ARRAY ARRAY['ChatSession', 'ChatConversation'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = source AND column_name = 'openaiConversationId'
    ) THEN
      EXECUTE format(
        'INSERT INTO "_OpenAIConversationToDelete" ("id")
         SELECT DISTINCT "openaiConversationId" FROM %I WHERE "openaiConversationId" IS NOT NULL
         ON CONFLICT DO NOTHING',
        source
      );
    END IF;
  END LOOP;
END $$;

-- DropTable
DROP TABLE IF EXISTS
  "Artifact",
  "ArtifactEdge",
  "ArtifactEmbedding",
  "BibleChapterDailyRollup",
  "BibleHighlight",
  "BibleReadingProgress",
  "BibleReadingSession",
  "BibleReadingSessionSegment",
  "ChatConversation",
  "ChatMessage",
  "ChatSession",
  "ChatSessionMemoryNote",
  "ConversationState",
  "DebugRun",
  "PipelineArtifact",
  "PipelineVault",
  "ReadingPlanReflection",
  "UserLifeContext",
  "UserMemoryState",
  "UserPreferences",
  "UserRollup",
  "VerseNote"
CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "DebugRunStatus";
DROP TYPE IF EXISTS "ReadingPlanReflectionKind";

-- CreateTable
CREATE TABLE "VaultKey" (
    "userId" TEXT NOT NULL,
    "keyCheck" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultKey_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "VaultRecord" (
    "userId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "indexToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultRecord_pkey" PRIMARY KEY ("userId","collection","id")
);

-- CreateIndex
CREATE INDEX "VaultRecord_userId_collection_indexToken_idx" ON "VaultRecord"("userId", "collection", "indexToken");

-- CreateIndex
CREATE INDEX "VaultRecord_userId_collection_updatedAt_idx" ON "VaultRecord"("userId", "collection", "updatedAt");

-- AddForeignKey
ALTER TABLE "VaultKey" ADD CONSTRAINT "VaultKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultRecord" ADD CONSTRAINT "VaultRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

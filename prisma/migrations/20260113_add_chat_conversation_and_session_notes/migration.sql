-- Add minimal managed conversation pointer and normalized session memory notes.

CREATE TABLE IF NOT EXISTS "ChatConversation" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL DEFAULT 'other',
  "mode" TEXT NOT NULL DEFAULT 'general',
  "previousResponseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_conversationId_key" ON "ChatConversation"("conversationId");
CREATE INDEX IF NOT EXISTS "ChatConversation_userId_idx" ON "ChatConversation"("userId");
CREATE INDEX IF NOT EXISTS "ChatConversation_userId_updatedAt_idx" ON "ChatConversation"("userId", "updatedAt");

ALTER TABLE "ChatConversation"
  ADD CONSTRAINT "ChatConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ChatSessionMemoryNote" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSessionMemoryNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatSessionMemoryNote_userId_createdAt_idx" ON "ChatSessionMemoryNote"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatSessionMemoryNote_conversationId_createdAt_idx" ON "ChatSessionMemoryNote"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatSessionMemoryNote_expiresAt_idx" ON "ChatSessionMemoryNote"("expiresAt");

ALTER TABLE "ChatSessionMemoryNote"
  ADD CONSTRAINT "ChatSessionMemoryNote_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("conversationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatSessionMemoryNote"
  ADD CONSTRAINT "ChatSessionMemoryNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



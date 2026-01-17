-- Durable chat transcript storage (no artifacts)
-- Tables: ChatSession, ChatMessage

CREATE TABLE IF NOT EXISTS "ChatSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "endedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatSession_userId_kind_sessionId_key"
  ON "ChatSession" ("userId", "kind", "sessionId");

CREATE INDEX IF NOT EXISTS "ChatSession_userId_kind_endedAt_idx"
  ON "ChatSession" ("userId", "kind", "endedAt");

CREATE INDEX IF NOT EXISTS "ChatSession_sessionId_idx"
  ON "ChatSession" ("sessionId");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id" TEXT NOT NULL,
  "chatSessionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "actions" JSONB,
  "clientTimestamp" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessage_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChatMessage_chatSessionId_createdAt_idx"
  ON "ChatMessage" ("chatSessionId", "createdAt");



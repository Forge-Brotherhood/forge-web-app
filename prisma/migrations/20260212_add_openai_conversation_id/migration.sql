-- Add openaiConversationId column to ChatConversation and ChatSession.
-- Stores the OpenAI Conversations API ID (e.g. "conv_xxxxx") for persistent conversation state.

ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "openaiConversationId" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "openaiConversationId" TEXT;

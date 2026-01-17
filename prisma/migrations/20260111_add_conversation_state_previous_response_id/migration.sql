-- Add Responses API session pointer to ConversationState

ALTER TABLE IF EXISTS "ConversationState"
  ADD COLUMN IF NOT EXISTS "previousResponseId" TEXT;



-- Add session-scoped personalization notes to ConversationState

ALTER TABLE IF EXISTS "ConversationState"
  ADD COLUMN IF NOT EXISTS "sessionMemoryNotes" JSONB;



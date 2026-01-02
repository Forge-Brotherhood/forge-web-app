-- Adds new GroupType enum values required by the current schema.
--
-- Must be executed in a separate command from any UPDATEs that use the new values:
-- Postgres requires the transaction that adds enum values to commit before those
-- values can be used.

ALTER TYPE "GroupType" ADD VALUE IF NOT EXISTS 'in_person';
ALTER TYPE "GroupType" ADD VALUE IF NOT EXISTS 'virtual';



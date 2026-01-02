-- Deprecated: Prisma `db execute` wraps each file in a transaction, and Postgres
-- requires the enum ADD VALUE transaction to commit before new values can be used.
--
-- Use these two scripts instead (run in separate commands):
-- - prisma/manual/group-type-add-values.sql
-- - prisma/manual/group-type-remap-values.sql



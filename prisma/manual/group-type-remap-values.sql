-- Remaps legacy Group.groupType values to the current schema's values.
--
-- Assumptions:
-- - 'circle' -> 'in_person'
-- - 'core'   -> 'virtual'
-- Adjust these mappings if your historical semantics differ.

UPDATE "Group"
SET "groupType" = 'in_person'
WHERE "groupType"::text = 'circle';

UPDATE "Group"
SET "groupType" = 'virtual'
WHERE "groupType"::text = 'core';



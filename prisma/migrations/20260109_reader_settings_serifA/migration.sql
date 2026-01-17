-- Normalize legacy ReaderSettings.fontType value.
-- Older clients used "serif". New clients use "serifA" | "serifB" | "sansSerif".

UPDATE "ReaderSettings"
SET "fontType" = 'serifA'
WHERE "fontType" = 'serif';



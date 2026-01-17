-- Canonical, auditable rollup snapshots for user month rollups
-- Source of truth for: "What did we know when we recommended X?"

CREATE TABLE IF NOT EXISTS "UserRollup" (
  -- User.id is stored as TEXT (Prisma String @default(uuid())), so keep this TEXT for FK compatibility.
  "userId" TEXT NOT NULL,
  "schema" TEXT NOT NULL,
  "windowStartUtc" DATE NOT NULL,
  "windowEndUtc" DATE NOT NULL,
  "generatedAtUtc" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT,
  "dataCoverage" JSONB,
  "expiresAt" TIMESTAMPTZ,

  CONSTRAINT "UserRollup_pkey" PRIMARY KEY ("userId", "windowEndUtc", "schema"),
  CONSTRAINT "UserRollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserRollup_userId_windowEndUtc_desc_idx"
  ON "UserRollup" ("userId", "windowEndUtc" DESC);

CREATE INDEX IF NOT EXISTS "UserRollup_userId_schema_idx"
  ON "UserRollup" ("userId", "schema");



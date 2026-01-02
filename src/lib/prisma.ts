import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

const databaseUrl = process.env.DATABASE_URL;

const getMissingDatabaseUrlError = () =>
  new Error(
    [
      "DATABASE_URL is not set.",
      "Set DATABASE_URL (and optionally DIRECT_URL / SHADOW_DATABASE_URL) before using Prisma.",
      'If you are using the local docker-compose Postgres, DATABASE_URL should look like:',
      'postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>?schema=public',
    ].join(" ")
  );

const createPrismaClient = (connectionString: string) => {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString,
      // Keep this low in serverless; the Neon pooler handles concurrency.
      max: 5,
    });

  globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

// Reuse the PrismaClient across hot reloads AND across warm serverless invocations.
// This helps avoid exhausting database connections in production.
export const prisma =
  globalForPrisma.prisma ??
  (databaseUrl
    ? createPrismaClient(databaseUrl)
    : (new Proxy({} as PrismaClient, {
        get() {
          throw getMissingDatabaseUrlError();
        },
      }) as PrismaClient));

if (databaseUrl) globalForPrisma.prisma = prisma;
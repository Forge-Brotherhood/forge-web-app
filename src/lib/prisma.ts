import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

const prismaConnectionString =
  process.env.DATABASE_URL ??
  // `next build` and `prisma generate` can run in environments without DATABASE_URL.
  // Prisma won't connect until a query is executed, but it does validate the URL at construction time.
  "postgresql://user:password@localhost:5432/postgres?schema=public";

// Reuse the PrismaClient across hot reloads AND across warm serverless invocations.
// This helps avoid exhausting database connections in production.
export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const pool =
      globalForPrisma.pgPool ??
      new Pool({
        connectionString: prismaConnectionString,
        // Keep this low in serverless; the Neon pooler handles concurrency.
        max: 5,
      });

    globalForPrisma.pgPool = pool;

    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  })();

globalForPrisma.prisma = prisma;
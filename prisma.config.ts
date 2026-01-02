/// <reference types="node" />

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    // Prisma 7+ prefers datasource URLs in prisma.config.ts (not schema.prisma).
    // Keep local builds working even if DATABASE_URL isn't set (prisma generate doesn't need to connect).
    url:
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/postgres?schema=public",
    directUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});



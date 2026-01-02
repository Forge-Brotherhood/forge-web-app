/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

const loadDotEnvIfNeeded = () => {
  if (process.env.DATABASE_URL) return;

  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIdx = line.indexOf("=");
    if (equalsIdx <= 0) continue;

    const key = line.slice(0, equalsIdx).trim();
    let value = line.slice(equalsIdx + 1).trim();

    if (!key || key in process.env) continue;

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
};

loadDotEnvIfNeeded();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prisma 7+ prefers datasource URLs in prisma.config.ts (not schema.prisma).
    // We do *not* hardcode credentials; we load DATABASE_URL from the environment / .env.
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});



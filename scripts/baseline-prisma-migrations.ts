import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type BaselineResult = {
  applied: string[];
  skipped: string[];
};

const runPrisma = (args: string[]) => {
  const result = spawnSync("npx", ["prisma", ...args], { encoding: "utf8" });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
};

const listMigrationDirectories = (migrationsDir: string) => {
  if (!fs.existsSync(migrationsDir)) return [];

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{8}_/.test(name))
    .sort();
};

const baselineMigrations = (migrationsDir: string): BaselineResult => {
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migrationName of listMigrationDirectories(migrationsDir)) {
    const { exitCode, output } = runPrisma(["migrate", "resolve", "--applied", migrationName]);

    if (exitCode === 0) {
      applied.push(migrationName);
      continue;
    }

    // Prisma exits non-zero when a migration is already recorded as applied (P3008).
    if (/P3008/i.test(output) || /already recorded as applied/i.test(output)) {
      skipped.push(migrationName);
      continue;
    }

    throw new Error(`Failed to baseline migration "${migrationName}".\n\n${output}`);
  }

  return { applied, skipped };
};

const main = () => {
  if (!process.env.DATABASE_URL) {
    console.error(
      [
        "Missing DATABASE_URL.",
        "Run with DATABASE_URL set (or create a local .env that prisma.config.ts can load).",
      ].join("\n"),
    );
    process.exit(1);
  }

  const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
  const { applied, skipped } = baselineMigrations(migrationsDir);

  console.log("\nBaseline complete.");
  console.log(`Applied: ${applied.length}`);
  console.log(`Skipped (already applied): ${skipped.length}`);
};

main();


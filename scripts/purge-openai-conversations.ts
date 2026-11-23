#!/usr/bin/env npx tsx
/**
 * Deletes, at OpenAI, the Guide conversations that used to be stored there.
 *
 * The Guide no longer stores conversations anywhere, but the ones held before that change stay
 * at OpenAI until they are deleted. Their ids were in the ChatSession and ChatConversation
 * tables; the migration that drops those tables (20261122_encrypt_private_data) keeps the ids in
 * "_OpenAIConversationToDelete". This script deletes each conversation at OpenAI, and drops that
 * table once nothing is left. It can be run before or after the migration, and run again if it
 * is interrupted or some deletions fail.
 *
 * Run it with the database and the OpenAI key of the environment being cleaned up: the
 * conversations belong to the project of the key that created them. Without those in the
 * environment, the values in .env are used (your local database).
 *
 * Usage:
 *   npx tsx scripts/purge-openai-conversations.ts            # reports what it would delete
 *   npx tsx scripts/purge-openai-conversations.ts --confirm  # deletes
 */

import { config } from "dotenv";
import * as path from "path";
import { Pool } from "pg";

config({ path: path.resolve(__dirname, "..", ".env") });

const HOLDING_TABLE = "_OpenAIConversationToDelete";
const SOURCE_TABLES = ["ChatSession", "ChatConversation"];

async function main() {
  const confirm = process.argv.includes("--confirm");
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const db = new Pool({ connectionString: databaseUrl, max: 2 });
  const tableExists = async (name: string) =>
    (await db.query("SELECT to_regclass($1) IS NOT NULL AS found", [`"${name}"`])).rows[0].found as boolean;

  const hasHoldingTable = await tableExists(HOLDING_TABLE);
  const sources: string[] = [];
  for (const table of SOURCE_TABLES) if (await tableExists(table)) sources.push(table);

  const ids = new Set<string>();
  if (hasHoldingTable) {
    for (const row of (await db.query(`SELECT "id" FROM "${HOLDING_TABLE}"`)).rows) ids.add(row.id);
  }
  for (const table of sources) {
    const rows = await db.query(`SELECT DISTINCT "openaiConversationId" AS id FROM "${table}" WHERE "openaiConversationId" IS NOT NULL`);
    for (const row of rows.rows) ids.add(row.id);
  }

  const url = new URL(databaseUrl);
  console.log(`Database: ${url.hostname}${url.pathname}`);
  console.log(`Conversations to delete at OpenAI: ${ids.size}`);
  if (!confirm) {
    console.log("Nothing was deleted. Run again with --confirm to delete them.");
    await db.end();
    return;
  }

  /** True once the conversation no longer exists at OpenAI. */
  const deleteAtOpenAI = async (id: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.openai.com/v1/conversations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => null);
      if (response?.ok || response?.status === 404) return true;
      if (response && response.status !== 429 && response.status < 500) return false;
    }
    return false;
  };

  const queue = [...ids];
  let deleted = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        if (await deleteAtOpenAI(id)) {
          deleted++;
          if (hasHoldingTable) await db.query(`DELETE FROM "${HOLDING_TABLE}" WHERE "id" = $1`, [id]);
        } else {
          failed++;
        }
      }
    })
  );

  console.log(`Deleted (or already gone): ${deleted}. Failed: ${failed}.`);

  // The old tables would refill the list when the migration runs, so the table is only dropped
  // once they are gone too.
  if (failed === 0 && hasHoldingTable && sources.length === 0) {
    await db.query(`DROP TABLE "${HOLDING_TABLE}"`);
    console.log(`Dropped "${HOLDING_TABLE}". Nothing is left to do.`);
  } else if (failed > 0) {
    console.log("Run this again to retry the ones that failed.");
  } else if (sources.length > 0) {
    console.log("The old tables still exist: run this once more after the migration to finish.");
  }

  await db.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Replays the heartbeat fixtures through a beat with the REAL model, for a person to read against
 * the soul doc (guide-soul.md, test set 13 to 18). It prints what the model was asked, what it
 * said, and what the code kept. It calls OpenAI and costs a little, so it is run by hand.
 *
 * Usage:
 *   npx tsx scripts/replay-beat.ts              # every fixture
 *   npx tsx scripts/replay-beat.ts grieving     # one or more, by name
 *   npx tsx scripts/replay-beat.ts --list
 *   npx tsx scripts/replay-beat.ts --raw        # also print the model's own answer, before the checks
 *
 * Needs OPENAI_API_KEY (from .env or the shell). Fixtures are in src/lib/heartbeat/fixtures.
 */

import { config } from "dotenv";
import * as path from "path";

config({ path: path.resolve(__dirname, "..", ".env") });

import { FIXTURES, FIXTURE_NOW } from "../src/lib/heartbeat/fixtures";
import { callBeatModel, BEAT_MODEL, type BeatModel } from "../src/lib/heartbeat/model";
import { runBeat } from "../src/lib/heartbeat/runBeat";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const f of FIXTURES) console.log(`${f.name.padEnd(24)} ${f.description}`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Add it to .env or the shell, then run this again.");
    process.exitCode = 1;
    return;
  }

  const raw = args.includes("--raw");
  const names = args.filter((a) => !a.startsWith("--"));
  const chosen = names.length ? FIXTURES.filter((f) => names.includes(f.name)) : FIXTURES;
  if (names.length && chosen.length !== names.length) {
    console.error(`Unknown fixture. Known: ${FIXTURES.map((f) => f.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Model ${BEAT_MODEL}. Clock fixed at ${FIXTURE_NOW.toISOString()} (Monday 10:00 in New York).\n`);
  for (const f of chosen) {
    let answer: unknown = undefined;
    const spy: BeatModel = async (input) => {
      answer = await callBeatModel(input);
      return answer;
    };
    const output = await runBeat(f.brief, FIXTURE_NOW, { trigger: f.trigger, callModel: spy });

    console.log("=".repeat(78));
    console.log(`${f.name}: ${f.description}`);
    console.log(`A good beat: ${f.expect}`);
    console.log(`Brief ${output.meta.staleness}, care mode ${output.meta.careMode}, model called ${output.meta.modelCalled}.`);
    if (raw && answer !== undefined) console.log(`\nThe model said:\n${JSON.stringify(answer, null, 2)}`);
    console.log("\nPosts kept:");
    if (!output.posts.length) console.log("  (none)");
    for (const p of output.posts) {
      console.log(`  [${p.reason}] ${p.message}`);
      if (p.card) console.log(`    card: ${p.card.kind} ${p.card.fallback_text}`);
      if (p.notify) console.log(`    notify: ${p.notify.text}`);
    }
    const plans = output.activities.filter((a) => a.action !== "create" || a.activity.status === "planned");
    console.log("Planned:");
    if (!plans.length) console.log("  (none)");
    for (const a of plans) {
      console.log(
        a.action === "create"
          ? `  ${a.activity.type} on ${a.activity.scheduledFor}${a.activity.scheduledTime ? ` ${a.activity.scheduledTime}` : ""}${a.activity.note ? ` (${a.activity.note})` : ""}`
          : `  ${a.action} ${a.activityId}`
      );
    }
    for (const w of output.workingNotes) console.log(`Working notes (${w.goalId}): ${w.workingNotes}`);
    for (const g of output.goalChanges) console.log(`Rhythm of ${g.goalId} lightened to ${g.rhythm}`);
    if (output.meta.dropped.length) console.log(`Dropped by the rules: ${output.meta.dropped.map((d) => `${d.what}:${d.code}`).join(", ")}`);
    console.log(`Next beat: ${output.nextBeatAt}\n`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  // The Bible cache client keeps a connection open; do not wait for it.
  .finally(() => process.exit());

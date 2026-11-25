import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { estimateUsd } from "@/lib/evals/cost";
import { evalSuite } from "@/lib/evals/suites";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/evals/runs?suiteId=
// A suite's runs, newest first, with how far each got and how many passed.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return unauthorized();
  const suiteId = new URL(request.url).searchParams.get("suiteId");
  if (!suiteId || !evalSuite(suiteId)) return NextResponse.json({ error: "Unknown suite" }, { status: 400 });

  const runs = await prisma.evalRun.findMany({
    where: { suiteId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { results: { select: { passed: true } } },
  });
  return NextResponse.json(
    {
      runs: runs.map(({ results, ...run }) => ({
        ...run,
        total: run.caseIds.length * run.repeats,
        done: results.length,
        passed: results.filter((r) => r.passed).length,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const bodySchema = z.object({
  suiteId: z.string().min(1).max(64),
  /** Some of the suite's cases; all of them when left out. */
  caseIds: z.array(z.string().min(1).max(100)).min(1).optional(),
  repeats: z.number().int().min(1).max(5).optional(),
  label: z.string().trim().max(200).optional(),
});

// POST /api/evals/runs
// Starts a run: records which cases and how many times. The admin then runs its items one by one.
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return unauthorized();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const suite = evalSuite(parsed.data.suiteId);
  if (!suite) return NextResponse.json({ error: "Unknown suite" }, { status: 400 });
  const known = new Set(suite.cases.map((c) => c.id));
  const caseIds = parsed.data.caseIds ?? [...known];
  if (caseIds.some((id) => !known.has(id))) return NextResponse.json({ error: "Unknown case" }, { status: 400 });
  const repeats = parsed.data.repeats ?? suite.repeats;

  const run = await prisma.evalRun.create({
    data: {
      suiteId: suite.id,
      suiteVersion: suite.version,
      label: parsed.data.label || null,
      caseIds: [...new Set(caseIds)],
      repeats,
      estimatedUsd: estimateUsd(suite, [...new Set(caseIds)], repeats),
    },
  });
  return NextResponse.json({ run }, { status: 201 });
}

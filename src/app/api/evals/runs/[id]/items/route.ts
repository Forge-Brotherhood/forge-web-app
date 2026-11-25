import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { callGrader } from "@/lib/evals/grader";
import { runItem } from "@/lib/evals/runner";
import { evalSuite } from "@/lib/evals/suites";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One case once: its model call and the grader's. 60 is within every plan.
export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  caseId: z.string().min(1).max(100),
  repeat: z.number().int().min(1).max(5),
});

// POST /api/evals/runs/[id]/items
// Runs one case of a run once, with the real model, and stores the result. Calls OpenAI, so it costs money.
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { id } = await params;
  const run = await prisma.evalRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { caseId, repeat } = parsed.data;
  if (!run.caseIds.includes(caseId) || repeat > run.repeats) {
    return NextResponse.json({ error: "Not part of this run" }, { status: 400 });
  }
  const suite = evalSuite(run.suiteId);
  if (!suite) return NextResponse.json({ error: "Unknown suite" }, { status: 400 });

  const result = await runItem(suite, caseId, repeat, callGrader);
  const data = {
    output: result.output,
    raw: result.raw === undefined ? Prisma.JsonNull : (result.raw as Prisma.InputJsonValue),
    checks: result.checks as unknown as Prisma.InputJsonValue,
    grade: result.grade ? (result.grade as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    passed: result.passed,
    error: result.error ?? null,
    durationMs: result.durationMs,
  };
  const saved = await prisma.evalResult.upsert({
    where: { runId_caseId_repeat: { runId: id, caseId, repeat } },
    create: { runId: id, caseId, repeat, ...data },
    update: data,
  });
  return NextResponse.json({ result: saved });
}

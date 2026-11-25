import { NextRequest, NextResponse } from "next/server";
import { compareRuns } from "@/lib/evals/compare";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/evals/runs/[id]?compareTo=
// One run and every result in it. With compareTo, another run of the same suite case by case.
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const run = await prisma.evalRun.findUnique({
    where: { id },
    include: { results: { orderBy: [{ caseId: "asc" }, { repeat: "asc" }] } },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const compareTo = new URL(request.url).searchParams.get("compareTo");
  let comparison = null;
  if (compareTo) {
    const other = await prisma.evalRun.findUnique({
      where: { id: compareTo },
      include: { results: { select: { caseId: true, passed: true } } },
    });
    if (!other || other.suiteId !== run.suiteId) {
      return NextResponse.json({ error: "No run of the same suite to compare with" }, { status: 400 });
    }
    // The earlier of the two is "before", whichever way round they were asked for.
    const [before, after] = other.createdAt <= run.createdAt ? [other.results, run.results] : [run.results, other.results];
    comparison = { runId: other.id, cases: compareRuns(before, after) };
  }

  return NextResponse.json({ run, comparison }, { headers: { "Cache-Control": "no-store" } });
}

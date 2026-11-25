import { NextRequest, NextResponse } from "next/server";
import { caseUsd } from "@/lib/evals/cost";
import { EVAL_SUITES } from "@/lib/evals/suites";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evals/suites
// Every eval suite and its cases, with a rough cost per run of each case. For the admin, with the cron secret.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const suites = EVAL_SUITES.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    repeats: s.repeats,
    version: s.version,
    cases: s.cases.map((c) => ({ ...c, usd: caseUsd(s, c.id) })),
  }));
  return NextResponse.json({ suites }, { headers: { "Cache-Control": "no-store" } });
}

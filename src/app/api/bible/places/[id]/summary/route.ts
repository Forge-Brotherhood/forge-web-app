import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getPlaceSummary } from "@/lib/guide/placeSummary";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/bible/places/:id/summary
// A short AI study note on the place, the same for everyone. { summary: null } when it could not be written.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const result = await getPlaceSummary(id);
    if (result === "not_found") {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }
    return NextResponse.json(result.summary ? { summary: result.summary, source: "ai" } : { summary: null });
  } catch (error) {
    console.error("Error fetching place summary:", error);
    return NextResponse.json({ error: "Failed to fetch place summary" }, { status: 500 });
  }
}

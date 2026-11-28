import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getAvailableTranslations, getCurrentProviderType } from "@/lib/bible/providers";
import { buildRoute, isJourney, isRouteSlug, routeSource, withVerseText } from "@/lib/guide/routes";
import { passageSource } from "@/lib/guide/uiBlocks";

type RouteParams = { params: Promise<{ slug: string }> };

// GET /api/bible/routes/:slug?translation=<id>
// One curated journey for the full map, with each stop's verse in the reader's translation.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const row = isRouteSlug(slug) ? await routeSource.getRouteRow(slug) : null;
    // A route with fewer than two stops is not a journey.
    if (!row || !isJourney(row)) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }

    const requested = request.nextUrl.searchParams.get("translation")?.trim().toUpperCase();
    const translation =
      requested && getAvailableTranslations(getCurrentProviderType()).includes(requested)
        ? requested
        : await passageSource.readerTranslation(authResult.userId);

    const route = await withVerseText(buildRoute(row), (bookId, chapter) =>
      passageSource.loadVerses({ bookId, chapter, verseStart: 1, verseEnd: 999 }, translation)
    );
    return NextResponse.json(route);
  } catch (error) {
    console.error("Error fetching Bible route:", error);
    return NextResponse.json({ error: "Failed to fetch route" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { getChapterPlaces } from "@/lib/guide/places";
import { routesForChapter } from "@/lib/guide/routes";

// The folder is [id] (the book code) because it sits beside /api/bible/chapter/[id].
type RouteParams = { params: Promise<{ id: string; chapter: string }> };

// GET /api/bible/chapter/:bookId/:chapter/places
// The chapter's places and the curated routes that belong to it, for the reader's map.
// Not cached here: it is one indexed query, and the route list is already cached in KV.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, chapter: chapterParam } = await params;
    const bookId = id.toUpperCase();
    if (!getBookDisplayNameFromCode(bookId)) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    const chapter = Number(chapterParam);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) {
      return NextResponse.json({ error: "Invalid chapter" }, { status: 400 });
    }

    const passage = await getChapterPlaces(bookId, chapter);
    return NextResponse.json({
      places: passage.places,
      routes: routesForChapter(passage.routes ?? [], bookId, chapter).map(({ slug, title }) => ({ slug, title })),
    });
  } catch (error) {
    console.error("Error fetching chapter places:", error);
    return NextResponse.json({ error: "Failed to fetch chapter places" }, { status: 500 });
  }
}

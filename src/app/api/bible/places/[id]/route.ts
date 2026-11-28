import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { LOW_CONFIDENCE } from "@/lib/guide/places";
import { getAvailableTranslations, getCurrentProviderType } from "@/lib/bible/providers";
import { placeChapterVerses, placeKeyVerses } from "@/lib/guide/placeSummary";
import { passageSource } from "@/lib/guide/uiBlocks";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/bible/places/:id?book=<BOOK>&chapter=<n>&translation=<id>
// One Bible place for the guide map's place sheet: details plus every verse that names it. With
// book and chapter, also chapterVerses: that chapter's verses naming the place, with their text.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const search = request.nextUrl.searchParams;
    const book = search.get("book")?.trim().toUpperCase();
    const chapterParam = search.get("chapter");
    const chapter = Number(chapterParam);
    if ((book || chapterParam) && (!book || !getBookDisplayNameFromCode(book) || !Number.isInteger(chapter) || chapter < 1 || chapter > 150)) {
      return NextResponse.json({ error: "Invalid book or chapter" }, { status: 400 });
    }

    const place = await prisma.biblePlace.findUnique({
      where: { id },
      include: { refs: { orderBy: [{ bookId: "asc" }, { chapter: "asc" }, { verse: "asc" }] } },
    });
    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    // The verse text is extra: if anything about it fails, the field is left out. Key verses stand
    // in when there is no chapter, or the chapter does not name the place.
    let chapterVerses: Awaited<ReturnType<typeof placeChapterVerses>> = null;
    let keyVerses: Awaited<ReturnType<typeof placeKeyVerses>> = null;
    const requested = search.get("translation")?.trim().toUpperCase();
    await (async () => {
      const translation =
        requested && getAvailableTranslations(getCurrentProviderType()).includes(requested)
          ? requested
          : await passageSource.readerTranslation(authResult.userId);
      const load = (range: { bookId: string; chapter: number; verseStart: number; verseEnd: number }) => passageSource.loadVerses(range, translation);
      if (book) chapterVerses = await placeChapterVerses(place.refs, book, chapter, load);
      if (!book || chapterVerses?.length === 0) keyVerses = await placeKeyVerses(place.refs, load);
    })().catch(() => undefined);

    return NextResponse.json({
      success: true,
      place: {
        id: place.id,
        name: place.name,
        label: place.label,
        lat: place.lat,
        lon: place.lon,
        confidence: place.confidence,
        uncertain: place.confidence < LOW_CONFIDENCE,
        modernName: place.modernName,
        refs: place.refs.map((r) => ({
          bookId: r.bookId,
          chapter: r.chapter,
          verse: r.verse,
          reference: `${getBookDisplayNameFromCode(r.bookId) ?? r.bookId} ${r.chapter}:${r.verse}`,
        })),
        attribution: "Place data: OpenBible.info (CC BY 4.0)",
        ...(chapterVerses ? { chapterVerses } : {}),
        ...(keyVerses ? { keyVerses } : {}),
      },
    });
  } catch (error) {
    console.error("Error fetching Bible place:", error);
    return NextResponse.json({ error: "Failed to fetch place" }, { status: 500 });
  }
}

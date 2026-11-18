import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { LOW_CONFIDENCE } from "@/lib/guide/places";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/bible/places/:id
// One Bible place for the guide map's place sheet: details plus every verse that names it.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const place = await prisma.biblePlace.findUnique({
      where: { id },
      include: { refs: { orderBy: [{ bookId: "asc" }, { chapter: "asc" }, { verse: "asc" }] } },
    });
    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

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
      },
    });
  } catch (error) {
    console.error("Error fetching Bible place:", error);
    return NextResponse.json({ error: "Failed to fetch place" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { BibleServiceError } from "@/lib/bible";

// GET /api/bible/search - Search Bible verses
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Bible search is no longer supported." },
      { status: 410 }
    );
  } catch (error) {
    console.error("Error searching Bible verses:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to search Bible verses" },
      { status: 500 }
    );
  }
}

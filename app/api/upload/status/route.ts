import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET endpoint to check media upload status
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const mediaIds = searchParams.get('mediaIds');

    if (!mediaIds) {
      return NextResponse.json(
        { error: "Media IDs are required" },
        { status: 400 }
      );
    }

    const mediaIdArray = mediaIds.split(',');

    // Get media records status
    const mediaRecords = await prisma.attachment.findMany({
      where: {
        id: {
          in: mediaIdArray,
        },
      },
      select: {
        id: true,
        uploadStatus: true,
        muxPlaybackId: true,
        type: true,
      },
    });

    return NextResponse.json({
      success: true,
      media: mediaRecords,
    });

  } catch (error) {
    console.error("Media status check error:", error);
    return NextResponse.json(
      { 
        error: "Failed to check media status",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
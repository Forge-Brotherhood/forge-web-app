import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Mux from "@mux/mux-node";
import { prisma } from "@/lib/prisma";

// Configure Mux client
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', '3gp', 'm4v'];

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { filename, fileSize, contentType } = body;

    if (!filename || !fileSize) {
      return NextResponse.json(
        { error: "Missing required fields: filename and fileSize" },
        { status: 400 }
      );
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 500MB limit" },
        { status: 400 }
      );
    }

    // Validate file type by extension
    const fileExtension = filename.toLowerCase().split('.').pop();
    if (!fileExtension || !ALLOWED_FORMATS.includes(fileExtension)) {
      return NextResponse.json(
        { error: `Unsupported file format. Allowed formats: ${ALLOWED_FORMATS.join(', ')}` },
        { status: 400 }
      );
    }

    // Create MUX direct upload
    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        mp4_support: 'standard'
      },
      cors_origin: '*', // In production, restrict this to your domain
      test: process.env.NODE_ENV !== 'production',
    });

    console.log("MUX upload created:", upload);

    // Create Media record immediately to ensure webhooks can find it
    const mediaRecord = await prisma.attachment.create({
      data: {
        type: 'video',
        url: upload.id, // Store upload ID as URL initially
        uploadStatus: 'uploading',
        // postId is null initially - will be linked when Post is created
      },
    });

    console.log("Media record created:", mediaRecord.id);

    return NextResponse.json({
      success: true,
      uploadUrl: upload.url,
      uploadId: upload.id,
      assetId: upload.asset_id,
      mediaId: mediaRecord.id, // Return the Media record ID
      message: "Upload URL generated and media record created"
    });

  } catch (error) {
    console.error("MUX upload API error:", error);
    return NextResponse.json(
      { 
        error: "Failed to create upload URL",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check upload status
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
    const uploadId = searchParams.get('uploadId');

    if (!uploadId) {
      return NextResponse.json(
        { error: "Upload ID is required" },
        { status: 400 }
      );
    }

    // Get upload status from MUX
    const upload = await mux.video.uploads.retrieve(uploadId);

    return NextResponse.json({
      success: true,
      upload: {
        id: upload.id,
        status: upload.status,
        assetId: upload.asset_id,
        error: upload.error
      }
    });

  } catch (error) {
    console.error("MUX upload status check error:", error);
    return NextResponse.json(
      { 
        error: "Failed to check upload status",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
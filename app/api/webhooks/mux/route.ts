import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Mux from "@mux/mux-node";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Configure Mux client
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headersList = await headers();
    
    // Verify webhook signature
    const signature = headersList.get('mux-signature');
    if (process.env.MUX_WEBHOOK_SIGNING_SECRET && signature) {
      try {
        // MUX sends signature in format: t=timestamp,v1=signature
        const sigParts = signature.split(',');
        let timestamp = '';
        let providedSignature = '';
        
        sigParts.forEach(part => {
          const [key, value] = part.split('=');
          if (key === 't') timestamp = value;
          if (key === 'v1') providedSignature = value;
        });
        
        // Create expected signature with timestamp + body
        const payload = timestamp + '.' + body;
        const expectedSignature = crypto
          .createHmac('sha256', process.env.MUX_WEBHOOK_SIGNING_SECRET)
          .update(payload)
          .digest('hex');
        
        if (providedSignature !== expectedSignature) {
          console.error('Invalid MUX webhook signature', {
            provided: providedSignature,
            expected: expectedSignature,
            timestamp,
            signatureHeader: signature
          });
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
        
        console.log('✅ MUX webhook signature verified');
      } catch (error) {
        console.error('Error verifying MUX webhook signature:', error);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }
    
    const event = JSON.parse(body);
    
    console.log("MUX webhook received:", event.type, event.data);

    switch (event.type) {
      case 'video.asset.ready':
      case 'video.asset.static_renditions.ready':
        await handleAssetReady(event.data);
        break;
        
      case 'video.asset.errored':
        await handleAssetErrored(event.data);
        break;
        
      case 'video.upload.created':
        await handleUploadCreated(event.data);
        break;
        
      case 'video.upload.asset_created':
        await handleUploadAssetCreated(event.data);
        break;
        
      case 'video.asset.deleted':
        await handleAssetDeleted(event.data);
        break;
        
      default:
        console.log(`Unhandled MUX webhook event type: ${event.type}`);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("MUX webhook processing error:", error);
    return NextResponse.json(
      { 
        error: "Webhook processing failed",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

async function handleAssetReady(data: any) {
  try {
    const asset = data;
    console.log("Asset ready:", asset.id);

    // Get asset details including playback IDs
    const muxAsset = await mux.video.assets.retrieve(asset.id);
    const playbackId = muxAsset.playback_ids?.[0]?.id;

    if (!playbackId) {
      console.error("No playback ID found for asset:", asset.id);
      return;
    }

    // Find media record using multiple strategies to handle timing edge cases
    let mediaRecord = null;
    
    // Strategy 1: Find by muxAssetId (normal case)
    mediaRecord = await prisma.media.findFirst({
      where: {
        muxAssetId: asset.id,
      },
    });

    // Strategy 2: If not found by asset ID, try finding by upload ID in the URL
    // This handles the case where the post was created before the upload completed
    if (!mediaRecord && asset.upload_id) {
      mediaRecord = await prisma.media.findFirst({
        where: {
          url: asset.upload_id,
          type: 'video',
        },
      });
      console.log(`Found media record by upload ID: ${asset.upload_id}`);
    }

    if (!mediaRecord) {
      console.error(`No media record found for MUX asset ${asset.id} with upload ID ${asset.upload_id}`);
      return;
    }

    // Update the media record
    const updateResult = await prisma.media.update({
      where: {
        id: mediaRecord.id,
      },
      data: {
        uploadStatus: 'ready',
        muxAssetId: asset.id,
        muxPlaybackId: playbackId,
        durationS: asset.duration ? Math.round(asset.duration) : null,
        url: `https://player.mux.com/${playbackId}`,
      },
    });

    console.log(`✅ Updated media record ${mediaRecord.id} for MUX asset ${asset.id} with playback ID ${playbackId}`);

  } catch (error) {
    console.error("Error handling asset ready:", error);
  }
}

async function handleAssetErrored(data: any) {
  try {
    const asset = data;
    console.log("Asset errored:", asset.id, asset.errors);

    // Find media record using multiple strategies to handle timing edge cases
    let mediaRecord = null;
    
    // Strategy 1: Find by muxAssetId (normal case)
    mediaRecord = await prisma.media.findFirst({
      where: {
        muxAssetId: asset.id,
      },
    });

    // Strategy 2: If not found by asset ID, try finding by upload ID in the URL
    if (!mediaRecord && asset.upload_id) {
      mediaRecord = await prisma.media.findFirst({
        where: {
          url: asset.upload_id,
          type: 'video',
        },
      });
      console.log(`Found media record by upload ID for error: ${asset.upload_id}`);
    }

    if (!mediaRecord) {
      console.error(`No media record found for errored MUX asset ${asset.id} with upload ID ${asset.upload_id}`);
      return;
    }

    // Update the media record to error status
    await prisma.media.update({
      where: {
        id: mediaRecord.id,
      },
      data: {
        uploadStatus: 'error',
        muxAssetId: asset.id, // Ensure asset ID is set even on error
      },
    });

    console.log(`✅ Updated media record ${mediaRecord.id} for errored MUX asset ${asset.id}`);

  } catch (error) {
    console.error("Error handling asset errored:", error);
  }
}

async function handleUploadCreated(data: any) {
  try {
    const upload = data;
    console.log("Upload created:", upload.id);
    // This event is just informational - the upload URL was created
    // No database updates needed at this stage
  } catch (error) {
    console.error("Error handling upload created:", error);
  }
}

async function handleUploadAssetCreated(data: any) {
  try {
    const upload = data;
    console.log("Upload asset created:", upload.id, "-> Asset:", upload.asset_id);

    // Find media record by upload ID
    const mediaRecord = await prisma.media.findFirst({
      where: {
        url: upload.id, // We initially store upload ID as URL
        type: 'video',
      },
    });

    if (!mediaRecord) {
      console.error(`No media record found for upload ${upload.id}`);
      return;
    }

    // Update media record with asset ID
    await prisma.media.update({
      where: {
        id: mediaRecord.id,
      },
      data: {
        muxAssetId: upload.asset_id,
        uploadStatus: 'processing',
      },
    });

    console.log(`✅ Updated media record ${mediaRecord.id} for upload ${upload.id} with asset ${upload.asset_id}`);

  } catch (error) {
    console.error("Error handling upload asset created:", error);
  }
}

async function handleAssetDeleted(data: any) {
  try {
    const asset = data;
    console.log("Asset deleted:", asset.id);

    // Find media record using multiple strategies to handle timing edge cases
    let mediaRecord = null;
    
    // Strategy 1: Find by muxAssetId (normal case)
    mediaRecord = await prisma.media.findFirst({
      where: {
        muxAssetId: asset.id,
      },
    });

    // Strategy 2: If not found by asset ID, try finding by upload ID in the URL
    if (!mediaRecord && asset.upload_id) {
      mediaRecord = await prisma.media.findFirst({
        where: {
          url: asset.upload_id,
          type: 'video',
        },
      });
      console.log(`Found media record by upload ID for deletion: ${asset.upload_id}`);
    }

    if (!mediaRecord) {
      console.error(`No media record found for deleted MUX asset ${asset.id} with upload ID ${asset.upload_id}`);
      return;
    }

    // Update media record to remove MUX references
    await prisma.media.update({
      where: {
        id: mediaRecord.id,
      },
      data: {
        muxAssetId: null,
        muxPlaybackId: null,
        uploadStatus: 'error',
      },
    });

    console.log(`✅ Updated media record ${mediaRecord.id} for deleted MUX asset ${asset.id}`);

  } catch (error) {
    console.error("Error handling asset deleted:", error);
  }
}
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { S3Service } from "@/lib/s3";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if S3 is configured
    if (!S3Service.isConfigured()) {
      return NextResponse.json(
        { error: "File storage is not configured. Please check server configuration." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("avatar") as File;
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image." },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB for S3 storage)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    // Get existing user to check for old avatar
    const existingUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { avatarUrl: true }
    });

    // Delete old avatar variants if they exist and are stored in S3
    if (existingUser?.avatarUrl && existingUser.avatarUrl.includes(process.env.S3_BUCKET_NAME || '')) {
      try {
        // Extract original filename from the stored URL
        const urlParts = existingUser.avatarUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        
        // Delete all variants of the old avatar
        await S3Service.deleteAvatarVariants(userId, filename);
      } catch (deleteError) {
        console.warn("Could not delete old avatar variants:", deleteError);
        // Continue with upload even if old file deletion fails
      }
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate S3 key for the new avatar
    const s3Key = S3Service.generateAvatarKey(userId, file.name);

    // Upload to S3
    const uploadResult = await S3Service.uploadFile(
      buffer,
      s3Key,
      file.type
    );

    // Update avatar URL in database
    await prisma.user.update({
      where: { clerkId: userId },
      data: { avatarUrl: uploadResult.url },
    });

    // Generate processed image URLs (these will be available after Lambda processing)
    const processedUrls = S3Service.getProcessedAvatarUrls(userId, file.name);

    return NextResponse.json({ 
      success: true, 
      avatarUrl: uploadResult.url, // Original image URL for immediate use
      key: uploadResult.key,
      processedUrls, // URLs for optimized variants (will be available shortly)
      message: "Avatar uploaded successfully. Optimized versions will be available shortly."
    });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get existing user to find the avatar to delete
    const existingUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { avatarUrl: true }
    });

    // Delete all avatar variants from S3 if they exist
    if (existingUser?.avatarUrl && S3Service.isConfigured() && existingUser.avatarUrl.includes(process.env.S3_BUCKET_NAME || '')) {
      try {
        // Extract original filename from the stored URL
        const urlParts = existingUser.avatarUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        
        // Delete all variants of the avatar
        await S3Service.deleteAvatarVariants(userId, filename);
      } catch (deleteError) {
        console.warn("Could not delete avatar variants from S3:", deleteError);
        // Continue with database update even if S3 deletion fails
      }
    }

    // Clear avatar URL from database
    await prisma.user.update({
      where: { clerkId: userId },
      data: { avatarUrl: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting avatar:", error);
    return NextResponse.json(
      { error: "Failed to delete avatar" },
      { status: 500 }
    );
  }
}

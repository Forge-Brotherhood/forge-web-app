import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return NextResponse.json(
        { error: "Image storage is not configured. Please check server configuration." },
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

    // Validate file size (max 10MB for Cloudinary)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    // Get existing user to check for old avatar (create if doesn't exist)
    let existingUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { profileImageUrl: true }
    });
    
    // If user doesn't exist in database, create them
    if (!existingUser) {
      const user = await currentUser();
      const email = user?.emailAddresses?.[0]?.emailAddress;
      if (!email) {
        return NextResponse.json({ error: "No email found for user" }, { status: 400 });
      }
      await prisma.user.create({
        data: {
          clerkId: userId,
          email,
          firstName: user?.firstName ?? null,
          lastName: user?.lastName ?? null,
          displayName: user?.firstName ?? user?.username ?? null,
          handle: user?.username ?? null,
          profileImageUrl: null,
        }
      });
      existingUser = { profileImageUrl: null };
    }

    // Delete old avatar if it exists in Cloudinary
    if (existingUser?.profileImageUrl && existingUser.profileImageUrl.includes('cloudinary')) {
      try {
        // Extract public_id from Cloudinary URL
        // URL format: https://res.cloudinary.com/[cloud_name]/image/upload/[transformations]/[version]/[public_id].[format]
        const urlParts = existingUser.profileImageUrl.split('/');
        const publicIdWithFormat = urlParts[urlParts.length - 1];
        const publicId = publicIdWithFormat.substring(0, publicIdWithFormat.lastIndexOf('.'));
        const fullPublicId = `forge/avatars/${publicId}`;
        
        // Delete from Cloudinary
        await cloudinary.uploader.destroy(fullPublicId);
      } catch (deleteError) {
        console.warn("Could not delete old avatar from Cloudinary:", deleteError);
        // Continue with upload even if old file deletion fails
      }
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Cloudinary with transformations
    return new Promise<NextResponse>((resolve) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: "image",
          folder: "forge/avatars",
          public_id: `${userId}_${Date.now()}`,
          overwrite: true,
          transformation: [
            { width: 400, height: 400, crop: "fill", gravity: "face" }
          ],
          eager: [
            { width: 50, height: 50, crop: "fill", gravity: "face" },
            { width: 200, height: 200, crop: "fill", gravity: "face" }
          ],
          eager_async: false,
          allowed_formats: ["jpg", "jpeg", "png", "webp", "avif", "gif"],
        },
        async (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            resolve(
              NextResponse.json(
                { error: `Upload failed: ${error.message}` },
                { status: 500 }
              )
            );
          } else if (result) {
            // Update avatar URL in database
            await prisma.user.update({
              where: { clerkId: userId },
              data: { profileImageUrl: result.secure_url },
            });

            // Get the transformation URLs
            const thumbnailUrl = result.eager?.[0]?.secure_url || result.secure_url;
            const avatarUrl = result.eager?.[1]?.secure_url || result.secure_url;

            resolve(
              NextResponse.json({ 
                success: true, 
                avatarUrl: result.secure_url,
                publicId: result.public_id,
                processedUrls: {
                  original: result.secure_url,
                  thumbnail: thumbnailUrl,
                  avatar: avatarUrl,
                  large: result.secure_url
                },
                message: "Avatar uploaded successfully."
              })
            );
          }
        }
      ).end(buffer);
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
      select: { profileImageUrl: true }
    });

    // Delete avatar from Cloudinary if it exists
    if (existingUser?.profileImageUrl && existingUser.profileImageUrl.includes('cloudinary')) {
      try {
        // Extract public_id from Cloudinary URL
        const urlParts = existingUser.profileImageUrl.split('/');
        const publicIdWithFormat = urlParts[urlParts.length - 1];
        const publicId = publicIdWithFormat.substring(0, publicIdWithFormat.lastIndexOf('.'));
        const fullPublicId = `forge/avatars/${publicId}`;
        
        // Delete from Cloudinary
        await cloudinary.uploader.destroy(fullPublicId);
      } catch (deleteError) {
        console.warn("Could not delete avatar from Cloudinary:", deleteError);
        // Continue with database update even if Cloudinary deletion fails
      }
    }

    // Clear avatar URL from database
    await prisma.user.update({
      where: { clerkId: userId },
      data: { profileImageUrl: null },
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

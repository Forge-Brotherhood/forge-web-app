import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No images provided" },
        { status: 400 }
      );
    }

    if (files.length > 4) {
      return NextResponse.json(
        { error: "Maximum 4 images allowed per post" },
        { status: 400 }
      );
    }

    const uploadPromises = files.map(async (file) => {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File ${file.name} exceeds 10MB limit`);
      }

      // Convert file to buffer
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Upload to Cloudinary
      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: "auto",
            folder: "forge/posts",
            allowed_formats: ALLOWED_FORMATS,
            context: {
              uploaded_by: userId,
              upload_source: "post_creation"
            }
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              reject(new Error(`Upload failed: ${error.message}`));
            } else if (result) {
              // Simply modify the existing secure URL to add transformations
              // The key is having f_auto in the URL path
              const transformations = 'w_1200,c_scale,q_auto:best,f_auto,dpr_auto,fl_progressive';
              
              // Split the original URL at /upload/ and insert transformations
              const urlParts = result.secure_url.split('/upload/');
              
              if (urlParts.length !== 2) {
                // Fallback to original URL if format is unexpected
                console.warn("Unexpected URL format, using original:", result.secure_url);
                resolve({
                  url: result.secure_url,
                  publicId: result.public_id,
                  width: result.width,
                  height: result.height,
                  format: result.format,
                  bytes: result.bytes,
                  type: "image"
                });
                return;
              }
              
              // Construct optimized URL with transformations
              const optimizedUrl = `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
              
              console.log("Original URL:", result.secure_url);
              console.log("Optimized URL:", optimizedUrl);
              console.log("Transformations applied:", transformations);
              
              resolve({
                url: optimizedUrl,
                publicId: result.public_id,
                width: result.width,
                height: result.height,
                format: result.format,
                bytes: result.bytes,
                type: "image"
              });
            }
          }
        ).end(buffer);
      });
    });

    try {
      const uploadResults = await Promise.all(uploadPromises);
      
      return NextResponse.json({
        success: true,
        images: uploadResults,
        message: `Successfully uploaded ${uploadResults.length} image${uploadResults.length > 1 ? 's' : ''}`
      });
    } catch (uploadError) {
      console.error("Image upload failed:", uploadError);
      return NextResponse.json(
        { error: uploadError instanceof Error ? uploadError.message : "Upload failed" },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
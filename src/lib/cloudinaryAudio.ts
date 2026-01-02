/**
 * Cloudinary Audio Upload Utility
 *
 * Handles uploading audio files to Cloudinary.
 * Note: Cloudinary uses resource_type "video" for audio files.
 */

import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface AudioUploadResult {
  url: string;
  publicId: string;
  duration: number | null;
  bytes: number;
}

/**
 * Upload audio buffer to Cloudinary
 *
 * @param buffer - Audio data as Buffer
 * @param publicId - Unique identifier for the file
 * @param folder - Cloudinary folder path
 */
export async function uploadAudioToCloudinary(
  buffer: Buffer,
  publicId: string,
  folder: string = "forge/reading-plan-audio"
): Promise<AudioUploadResult> {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Cloudinary is not configured");
  }

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          resource_type: "video", // Cloudinary uses "video" for audio files
          folder,
          public_id: publicId,
          format: "mp3",
          overwrite: true,
        },
        (error, result) => {
          if (error) {
            console.error("Cloudinary audio upload error:", error);
            reject(new Error(`Cloudinary upload failed: ${error.message}`));
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              duration: result.duration || null,
              bytes: result.bytes,
            });
          } else {
            reject(new Error("Cloudinary upload returned no result"));
          }
        }
      )
      .end(buffer);
  });
}

/**
 * Delete audio file from Cloudinary
 *
 * @param publicId - The public ID of the file to delete
 */
export async function deleteAudioFromCloudinary(
  publicId: string
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "video",
    });
  } catch (error) {
    console.warn("Failed to delete audio from Cloudinary:", error);
    // Don't throw - deletion failures shouldn't block operations
  }
}

/**
 * Generate a unique public ID for reading plan audio
 */
export function generateAudioPublicId(
  templateId: string,
  dayNumber: number
): string {
  return `day_${dayNumber}_${Date.now()}`;
}

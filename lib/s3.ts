import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL!;
const IMAGE_RESIZER_API_URL = process.env.IMAGE_RESIZER_API_URL || 'https://fe1l5p9vy1.execute-api.us-east-1.amazonaws.com/production';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
}

export interface ImageVariants {
  original: string;
  thumbnail?: string;
  avatar?: string;
  large?: string;
}

export interface ProcessedImageUrls {
  original: string;
  thumbnail: string;
  avatar: string;
  large: string;
}

export class S3Service {
  /**
   * Upload a file to S3
   */
  static async uploadFile(
    file: Buffer,
    key: string,
    contentType: string
  ): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file,
      ContentType: contentType,
      // Note: No ACL needed since bucket is configured for public read access
    });

    await s3Client.send(command);

    // Return the URL for accessing the file
    const url = `${STORAGE_BASE_URL}/${key}`;

    return {
      key,
      url,
      bucket: BUCKET_NAME,
    };
  }

  /**
   * Delete a file from S3
   */
  static async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  }

  /**
   * Generate a presigned URL for secure file access (for private files)
   */
  static async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
  }

  /**
   * Generate a unique S3 key for a user's avatar (original upload)
   */
  static generateAvatarKey(userId: string, originalFileName: string): string {
    const timestamp = Date.now();
    const extension = originalFileName.split('.').pop();
    return `profile-pictures/${userId}/avatar-${timestamp}.${extension}`;
  }

  /**
   * Get processed image URLs for a user's avatar using the image-resizer API
   * This function constructs the URLs for resized variants via API Gateway
   */
  static getProcessedAvatarUrls(userId: string, originalFileName: string): ProcessedImageUrls {
    const userPath = `profile-pictures/${userId}`;
    const imagePath = `${userPath}/${originalFileName}`;
    
    // Original image from S3
    const originalUrl = `${STORAGE_BASE_URL}/${imagePath}`;
    
    // Resized images via API Gateway
    const thumbnailUrl = `${IMAGE_RESIZER_API_URL}/${imagePath}?width=50&height=50`;
    const avatarUrl = `${IMAGE_RESIZER_API_URL}/${imagePath}?width=200&height=200`;
    const largeUrl = `${IMAGE_RESIZER_API_URL}/${imagePath}?width=400&height=400`;

    return {
      original: originalUrl,
      thumbnail: thumbnailUrl,
      avatar: avatarUrl,
      large: largeUrl
    };
  }

  /**
   * Check if original image exists (with image-resizer API, variants are always available on-demand)
   */
  static async checkProcessedVariantsExist(userId: string, originalFileName: string): Promise<ImageVariants> {
    const userPath = `profile-pictures/${userId}`;
    const originalKey = `${userPath}/${originalFileName}`;
    
    const variants: ImageVariants = {
      original: originalKey
    };

    try {
      // Check if original exists
      await s3Client.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: originalKey
      }));
      
      // With image-resizer API, all variants are available on-demand
      variants.thumbnail = `${IMAGE_RESIZER_API_URL}/${originalKey}?width=50&height=50`;
      variants.avatar = `${IMAGE_RESIZER_API_URL}/${originalKey}?width=200&height=200`;
      variants.large = `${IMAGE_RESIZER_API_URL}/${originalKey}?width=400&height=400`;

    } catch (error) {
      console.error('Error checking original image:', error);
    }

    return variants;
  }

  /**
   * Delete avatar (with image-resizer API, only need to delete original)
   */
  static async deleteAvatarVariants(userId: string, originalFileName: string): Promise<void> {
    const userPath = `profile-pictures/${userId}`;
    const originalKey = `${userPath}/${originalFileName}`;

    try {
      // Only need to delete the original - resized variants are generated on-demand
      await this.deleteFile(originalKey);
    } catch (error) {
      console.debug(`Could not delete ${originalKey}:`, error);
    }
  }

  /**
   * Generate a unique S3 key for documents
   */
  static generateDocumentKey(userId: string, originalFileName: string): string {
    const timestamp = Date.now();
    const sanitizedFileName = originalFileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `documents/${userId}/${timestamp}-${sanitizedFileName}`;
  }

  /**
   * Generate a unique S3 key for media files
   */
  static generateMediaKey(userId: string, originalFileName: string): string {
    const timestamp = Date.now();
    const sanitizedFileName = originalFileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `media/${userId}/${timestamp}-${sanitizedFileName}`;
  }

  /**
   * Extract user ID from a profile picture key
   */
  static extractUserIdFromKey(key: string): string | null {
    const match = key.match(/^profile-pictures\/([^\/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Check if the environment has S3 configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION &&
      process.env.S3_BUCKET_NAME &&
      process.env.STORAGE_BASE_URL
    );
  }
}
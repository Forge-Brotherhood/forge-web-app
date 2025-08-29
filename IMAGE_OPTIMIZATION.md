# Image Optimization with AWS Lambda + Sharp

## Overview

The profile picture upload system now includes automatic image optimization using AWS Lambda and the Sharp image processing library. When users upload images, they are automatically processed into multiple optimized variants.

## How It Works

1. **Upload**: User uploads original image to S3 `profile-pictures/{userId}/` folder
2. **Trigger**: S3 event notification automatically triggers the Lambda function
3. **Process**: Lambda function creates optimized variants using Sharp:
   - **Thumbnails**: 50x50px (for UI lists)
   - **Avatars**: 200x200px (for profile display)  
   - **Large**: 400x400px (for profile editing)
4. **Format**: Each size created in both WebP (modern browsers) and original format (fallback)
5. **Store**: Processed images stored in organized folder structure:

```
profile-pictures/
  {userId}/
    avatar-{timestamp}.jpg           # Original upload
    thumbnails/
      avatar-{timestamp}-50x50.webp
      avatar-{timestamp}-50x50.jpg
    avatars/
      avatar-{timestamp}-200x200.webp
      avatar-{timestamp}-200x200.jpg
    large/
      avatar-{timestamp}-400x400.webp
      avatar-{timestamp}-400x400.jpg
```

## Using Optimized Images

### S3Service Methods

```typescript
// Get URLs for all processed variants
const urls = S3Service.getProcessedAvatarUrls(userId, originalFileName);

// Check which variants are available
const variants = await S3Service.checkProcessedVariantsExist(userId, originalFileName);

// Delete all variants when removing avatar
await S3Service.deleteAvatarVariants(userId, originalFileName);
```

### OptimizedAvatar Component

```tsx
import { OptimizedAvatar } from '@/components/ui/optimized-avatar';

<OptimizedAvatar
  userId={user.id}
  avatarUrl={user.avatarUrl}
  size="avatar"  // or "thumbnail" or "large"
  fallbackText={user.name}
  className="w-12 h-12"
/>
```

## Features

- **Automatic Processing**: No manual intervention required
- **WebP Support**: Modern format with 25-35% smaller file sizes
- **Progressive Loading**: Shows original immediately, upgrades to optimized version
- **Fallback Support**: Gracefully handles missing optimized variants
- **Smart Cleanup**: Deletes all variants when user uploads new avatar

## Performance Benefits

- **Faster Loading**: Smaller file sizes mean faster page loads
- **Better UX**: Appropriate sizes for different use cases
- **CDN Ready**: Optimized for CloudFront caching (production)
- **Modern Formats**: WebP support for compatible browsers

## Development vs Production

### Development
- Direct S3 URLs
- Public bucket access
- Processing happens in background

### Production  
- CloudFront CDN URLs (`cdn.forge-app.io`)
- Private bucket with OAI access
- Global edge caching
- Same processing pipeline

## Processing Time

- **Small images** (< 1MB): 2-3 seconds
- **Large images** (2-5MB): 3-5 seconds
- Original image available immediately
- Optimized variants available after processing

## Monitoring

Check Lambda function logs in CloudWatch:
- Function: `forge-image-processor-dev`
- Log Group: `/aws/lambda/forge-image-processor-dev`

## Future Enhancements

- Format conversion (HEIC → JPEG)
- EXIF data stripping for privacy
- Face detection for smart cropping
- Batch processing for existing images
- Progressive JPEG encoding
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";
import { sendGroupNotificationAsync } from "@/lib/notifications";

const createPostSchema = z.object({
  kind: z.enum(["request", "update", "testimony", "encouragement", "verse", "system"]),
  content: z.string().min(1),
  // Changed from mediaUrls to mediaIds for linking existing records
  mediaIds: z.array(z.string()).optional(), // Array of Media record IDs
  // Keep mediaUrls for backward compatibility with images
  mediaUrls: z.array(z.object({
    url: z.string(),
    type: z.enum(["image", "video", "audio"]),
    width: z.number().optional(),
    height: z.number().optional(),
    durationS: z.number().optional(),
    // MUX-specific fields for videos
    muxAssetId: z.string().optional(),
    muxPlaybackId: z.string().optional(),
    uploadStatus: z.enum(["uploading", "processing", "ready", "error"]).optional(),
    // For tracking upload progress
    uploadId: z.string().optional(),
    filename: z.string().optional(),
  })).optional(),
});

// GET /api/threads/[id]/posts - Get all posts in a thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Resolve id or shortId
    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id }, { shortId: id }], deletedAt: null },
      select: { id: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Verify request exists and user has access
    const thread = await prisma.prayerRequest.findUnique({
      where: { 
        id: resolved.id,
      },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId: user.id,
                status: "active",
              },
            },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const isMember = thread.group ? thread.group.members.length > 0 : false;
    if (!isMember && !thread.sharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const posts = await prisma.prayerEntry.findMany({
      where: {
        requestId: resolved.id,
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
        attachments: true,
        responses: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
              },
            },
          },
        },
        _count: {
          select: {
            actions: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Sanitize if thread is anonymous
    const sanitizedPosts = posts.map(post => ({
      ...post,
      author: thread.isAnonymous && post.authorId === thread.authorId ? null : post.author,
    }));

    return NextResponse.json(sanitizedPosts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    return NextResponse.json(
      { error: "Failed to fetch posts" },
      { status: 500 }
    );
  }
}

// POST /api/threads/[id]/posts - Add a new post to a thread
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = createPostSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id }, { shortId: id }], deletedAt: null },
      select: { id: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Verify request exists and user has access
    const thread = await prisma.prayerRequest.findUnique({
      where: { 
        id: resolved.id,
      },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId: user.id,
                status: "active",
              },
            },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const isMember = thread.group ? thread.group.members.length > 0 : false;
    if (!isMember && !thread.sharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Validate post type restrictions
    if (validatedData.kind === "request") {
      return NextResponse.json(
        { error: "Cannot create additional prayer requests in an existing thread" },
        { status: 400 }
      );
    }

    if (validatedData.kind === "update" && thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Only the thread author can post updates" },
        { status: 403 }
      );
    }

    // Create entry with attachments in transaction
    const post = await prisma.$transaction(async (tx) => {
      const newPost = await tx.prayerEntry.create({
        data: {
          shortId: nanoid(12),
          requestId: resolved.id,
          authorId: user.id,
          kind: validatedData.kind as any,
          content: validatedData.content,
        },
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              profileImageUrl: true,
            },
          },
          attachments: true,
          responses: true,
          _count: {
            select: {
              actions: true,
            },
          },
        },
      });

      // Handle linking existing Attachment records (new approach for videos)
      if (validatedData.mediaIds && validatedData.mediaIds.length > 0) {
        const attachments = await tx.attachment.findMany({
          where: {
            id: {
              in: validatedData.mediaIds,
            },
          },
        });

        console.log(`Found ${attachments.length} attachments to link to entry ${newPost.id}`);
        
        if (attachments.length > 0) {
          await tx.attachment.updateMany({
            where: {
              id: {
                in: attachments.map(m => m.id),
              },
            },
            data: {
              entryId: newPost.id,
            },
          });
          console.log(`✅ Linked ${attachments.length} attachments to entry ${newPost.id}`);
        }
      }

      // Handle creating new Attachment records (backward compatibility for images)
      if (validatedData.mediaUrls && validatedData.mediaUrls.length > 0) {
        await tx.attachment.createMany({
          data: validatedData.mediaUrls.map(media => ({
            entryId: newPost.id,
            type: media.type as any,
            url: media.url,
            width: media.width,
            height: media.height,
            durationS: media.durationS,
            muxAssetId: media.muxAssetId,
            muxPlaybackId: media.muxPlaybackId,
            uploadStatus: (media.uploadStatus as any) || 'ready',
          })),
        });
      }

      // Fetch the complete entry with linked attachments
      const completePost = await tx.prayerEntry.findUnique({
        where: { id: newPost.id },
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              profileImageUrl: true,
            },
          },
          attachments: true,
          responses: true,
          _count: {
            select: {
              actions: true,
            },
          },
        },
      });

      if (!completePost) {
        throw new Error('Failed to fetch complete post');
      }

      // Update thread's updatedAt timestamp
      await tx.prayerRequest.update({
        where: { id: resolved.id },
        data: {
          lastActivityAt: new Date(),
          // If this is a testimony, mark request as answered
          ...(validatedData.kind === "testimony" && { status: "answered" }),
        },
      });

      return completePost;
    });

    // Sanitize if thread is anonymous and post is from thread author
    const sanitizedPost = {
      ...post,
      author: thread.isAnonymous && post.authorId === thread.authorId ? null : post.author,
    };

    // Send push notification to group members for updates/testimonies (fire-and-forget)
    if (
      thread.groupId &&
      thread.group &&
      (validatedData.kind === "update" || validatedData.kind === "testimony")
    ) {
      const isAnonymousAuthor = thread.isAnonymous && post.authorId === thread.authorId;
      const authorName = isAnonymousAuthor
        ? undefined
        : post.author?.displayName || post.author?.firstName || undefined;
      const authorProfileImageUrl = isAnonymousAuthor
        ? undefined
        : post.author?.profileImageUrl || undefined;

      sendGroupNotificationAsync(
        validatedData.kind === "testimony" ? "testimony" : "prayer_update",
        {
          groupId: thread.groupId,
          groupName: thread.group.name || "Your Group",
          threadId: thread.id,
          threadTitle: thread.title || validatedData.content.substring(0, 50),
          authorName,
          authorProfileImageUrl,
          excludeUserId: user.id, // Don't notify the author
          entryId: post.id, // Scroll to this specific post
        }
      );
    }

    return NextResponse.json(sanitizedPost, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating post:", error);
    return NextResponse.json(
      { error: "Failed to create post" },
      { status: 500 }
    );
  }
}

// PATCH /api/threads/[id]/posts - Update a post
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { postId, content } = body;

    if (!postId || !content) {
      return NextResponse.json(
        { error: "Post ID and content required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if post exists and user is the author
    const post = await prisma.prayerEntry.findUnique({
      where: { id: postId },
      include: {
        request: true,
      },
    });

    if (!post || post.requestId !== id) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    if (post.authorId !== user.id) {
      return NextResponse.json(
        { error: "You can only edit your own posts" },
        { status: 403 }
      );
    }

    // Update the post
    const updatedPost = await prisma.prayerEntry.update({
      where: { id: postId },
      data: { 
        content,
        updatedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
        attachments: true,
        responses: true,
        _count: {
          select: {
            actions: true,
          },
        },
      },
    });

    // Map to legacy shape
    return NextResponse.json(updatedPost);
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json(
      { error: "Failed to update post" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id]/posts - Delete a post
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const postId = searchParams.get("postId");

    if (!postId) {
      return NextResponse.json(
        { error: "Post ID required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if post exists and user has permission to delete
    const post = await prisma.prayerEntry.findUnique({
      where: { id: postId },
    });

    if (!post || post.requestId !== id) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    // Only allow deletion of non-request posts by their authors
    if (post.kind === "request") {
      return NextResponse.json(
        { error: "Cannot delete the initial prayer request" },
        { status: 400 }
      );
    }

    if (post.authorId !== user.id) {
      return NextResponse.json(
        { error: "You can only delete your own posts" },
        { status: 403 }
      );
    }

    // Delete the post (cascades to attachments and responses)
    await prisma.prayerEntry.delete({
      where: { id: postId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json(
      { error: "Failed to delete post" },
      { status: 500 }
    );
  }
}
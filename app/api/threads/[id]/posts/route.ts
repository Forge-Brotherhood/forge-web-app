import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

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

    // Verify thread exists and user has access
    const thread = await prisma.thread.findUnique({
      where: { 
        id,
        deletedAt: null,
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

    const posts = await prisma.post.findMany({
      where: {
        threadId: id,
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
        media: true,
        reactions: {
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
            prayerActions: true,
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

    // Verify thread exists and user has access
    const thread = await prisma.thread.findUnique({
      where: { 
        id,
        deletedAt: null,
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

    // Create post with media in transaction
    const post = await prisma.$transaction(async (tx) => {
      const newPost = await tx.post.create({
        data: {
          threadId: id,
          authorId: user.id,
          kind: validatedData.kind,
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
          media: true,
          reactions: true,
          _count: {
            select: {
              prayerActions: true,
            },
          },
        },
      });

      // Handle linking existing Media records (new approach for videos)
      if (validatedData.mediaIds && validatedData.mediaIds.length > 0) {
        // First, verify these media records exist and get their current state
        const mediaRecords = await tx.media.findMany({
          where: {
            id: {
              in: validatedData.mediaIds,
            },
          },
        });

        console.log(`Found ${mediaRecords.length} media records to link to post ${newPost.id}`);
        
        if (mediaRecords.length > 0) {
          // Update only the records we found, regardless of their current postId
          await tx.media.updateMany({
            where: {
              id: {
                in: mediaRecords.map(m => m.id),
              },
            },
            data: {
              postId: newPost.id,
            },
          });
          console.log(`✅ Linked ${mediaRecords.length} media records to post ${newPost.id}`);
        }
      }

      // Handle creating new Media records (backward compatibility for images)
      if (validatedData.mediaUrls && validatedData.mediaUrls.length > 0) {
        await tx.media.createMany({
          data: validatedData.mediaUrls.map(media => ({
            postId: newPost.id,
            type: media.type,
            url: media.url,
            width: media.width,
            height: media.height,
            durationS: media.durationS,
            muxAssetId: media.muxAssetId,
            muxPlaybackId: media.muxPlaybackId,
            uploadStatus: media.uploadStatus || 'ready',
          })),
        });
      }

      // Fetch the complete post with linked media
      const completePost = await tx.post.findUnique({
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
          media: true,
          reactions: true,
          _count: {
            select: {
              prayerActions: true,
            },
          },
        },
      });

      if (!completePost) {
        throw new Error('Failed to fetch complete post');
      }

      // Update thread's updatedAt timestamp
      await tx.thread.update({
        where: { id },
        data: {
          updatedAt: new Date(),
          // If this is a testimony, mark thread as answered
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
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        thread: true,
      },
    });

    if (!post || post.threadId !== id) {
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
    const updatedPost = await prisma.post.update({
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
        media: true,
        reactions: true,
        _count: {
          select: {
            prayerActions: true,
          },
        },
      },
    });

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
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post || post.threadId !== id) {
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

    // Delete the post (cascades to media and reactions)
    await prisma.post.delete({
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
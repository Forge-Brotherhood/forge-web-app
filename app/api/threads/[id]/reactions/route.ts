import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ReactionType, PostKind } from "@prisma/client";
import { cookies } from "next/headers";
import crypto from "crypto";

// Helper to get or create guest session
async function getOrCreateGuestSession() {
  const cookieStore = await cookies();
  let deviceHash = cookieStore.get("device_id")?.value;
  
  if (!deviceHash) {
    // Generate a new device ID
    deviceHash = crypto.randomBytes(32).toString("hex");
    cookieStore.set("device_id", deviceHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  // Find or create guest user
  let guestUser = await prisma.user.findFirst({
    where: { 
      clerkId: deviceHash,
      email: `guest_${deviceHash}@temp.local`
    },
  });

  if (!guestUser) {
    guestUser = await prisma.user.create({
      data: { 
        clerkId: deviceHash,
        email: `guest_${deviceHash}@temp.local`,
        displayName: "Guest User",
        role: "guest"
      },
    });
  }

  return guestUser;
}

// POST /api/threads/[id]/reactions - Add a reaction to a post
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const { userId } = await auth();
    const { postId, type, payload } = await req.json();

    // Validate reaction type
    if (!type || !Object.values(ReactionType).includes(type)) {
      return NextResponse.json(
        { error: "Invalid reaction type" },
        { status: 400 }
      );
    }

    // Get user (authenticated or guest)
    let user;
    if (userId) {
      user = await prisma.user.findUnique({
        where: { clerkId: userId }
      });
      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }
    } else {
      // Allow guests only for "amen" reactions
      if (type !== ReactionType.amen) {
        return NextResponse.json(
          { error: "Authentication required for this reaction type" },
          { status: 401 }
        );
      }
      user = await getOrCreateGuestSession();
    }

    // Check if post exists and belongs to the thread
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        thread: true
      }
    });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    if (post.threadId !== threadId) {
      return NextResponse.json(
        { error: "Post does not belong to this thread" },
        { status: 400 }
      );
    }

    // Prevent self-reactions for amen on own prayer request
    if (type === ReactionType.amen && post.kind === PostKind.request && post.authorId === user.id) {
      return NextResponse.json(
        { error: "You cannot pray for your own prayer request" },
        { status: 400 }
      );
    }

    // Check if user already has this reaction
    const existingReaction = await prisma.reaction.findFirst({
      where: {
        postId,
        userId: user.id,
        type
      }
    });

    if (existingReaction) {
      return NextResponse.json(
        { error: "You have already added this reaction" },
        { status: 400 }
      );
    }

    // Create the reaction
    const reaction = await prisma.reaction.create({
      data: {
        postId,
        userId: user.id,
        type,
        payload: payload || null
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true
          }
        }
      }
    });

    // If this is an "amen" reaction, also create a prayer action
    if (type === ReactionType.amen) {
      await prisma.prayerAction.create({
        data: {
          userId: user.id,
          postId,
          threadId
        }
      });

      // Update user's prayer streak if authenticated
      if (userId) {
        const lastPrayerAt = user.lastPrayerAt;
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        let newStreak = user.prayerStreak || 0;
        if (!lastPrayerAt || lastPrayerAt < oneDayAgo) {
          // Reset or increment streak
          const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
          newStreak = lastPrayerAt && lastPrayerAt >= twoDaysAgo ? newStreak + 1 : 1;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastPrayerAt: now,
            prayerStreak: newStreak
          }
        });
      }
    }

    // Get updated reaction count
    const reactionCount = await prisma.reaction.count({
      where: { 
        postId,
        type
      }
    });

    return NextResponse.json({
      reaction,
      reactionCount,
      message: "Reaction added successfully"
    }, { status: 201 });
  } catch (error) {
    console.error("Error adding reaction:", error);
    return NextResponse.json(
      { error: "Failed to add reaction" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id]/reactions - Remove a reaction
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const { userId } = await auth();
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get('postId');
    const type = searchParams.get('type') as ReactionType;

    if (!postId || !type) {
      return NextResponse.json(
        { error: "Post ID and reaction type required" },
        { status: 400 }
      );
    }

    // Get user (authenticated or guest)
    let user;
    if (userId) {
      user = await prisma.user.findUnique({
        where: { clerkId: userId }
      });
      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }
    } else {
      user = await getOrCreateGuestSession();
    }

    // Check if post exists and belongs to the thread
    const post = await prisma.post.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    if (post.threadId !== threadId) {
      return NextResponse.json(
        { error: "Post does not belong to this thread" },
        { status: 400 }
      );
    }

    // Delete the reaction
    const deleted = await prisma.reaction.deleteMany({
      where: {
        postId,
        userId: user.id,
        type
      }
    });

    if (deleted.count === 0) {
      return NextResponse.json(
        { error: "Reaction not found" },
        { status: 404 }
      );
    }

    // If this was an "amen" reaction, also delete the prayer action
    if (type === ReactionType.amen) {
      await prisma.prayerAction.deleteMany({
        where: {
          userId: user.id,
          postId
        }
      });
    }

    // Get updated reaction count
    const reactionCount = await prisma.reaction.count({
      where: { 
        postId,
        type
      }
    });

    return NextResponse.json({
      reactionCount,
      message: "Reaction removed successfully"
    });
  } catch (error) {
    console.error("Error removing reaction:", error);
    return NextResponse.json(
      { error: "Failed to remove reaction" },
      { status: 500 }
    );
  }
}

// GET /api/threads/[id]/reactions - Get reactions for a thread or specific post
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get('postId');
    const type = searchParams.get('type') as ReactionType | null;

    let reactions;
    
    if (postId) {
      // Get reactions for a specific post
      const whereClause: any = { postId };
      if (type) {
        whereClause.type = type;
      }

      reactions = await prisma.reaction.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
              handle: true,
              isSponsor: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } else {
      // Get all reactions for the thread
      const posts = await prisma.post.findMany({
        where: { threadId },
        select: { id: true }
      });

      const postIds = posts.map(p => p.id);
      
      const whereClause: any = { postId: { in: postIds } };
      if (type) {
        whereClause.type = type;
      }

      reactions = await prisma.reaction.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
              handle: true,
              isSponsor: true
            }
          },
          post: {
            select: {
              id: true,
              kind: true,
              content: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    // Group reactions by type for summary
    const summary = reactions.reduce((acc, reaction) => {
      if (!acc[reaction.type]) {
        acc[reaction.type] = 0;
      }
      acc[reaction.type]++;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      reactions,
      summary,
      total: reactions.length
    });
  } catch (error) {
    console.error("Error fetching reactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch reactions" },
      { status: 500 }
    );
  }
}
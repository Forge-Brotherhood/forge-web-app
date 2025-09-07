import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ThreadDetail } from "./thread-detail";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  
  const thread = await prisma.thread.findUnique({
    where: { 
      id,
      deletedAt: null,
    },
    select: {
      title: true,
      isAnonymous: true,
      author: {
        select: {
          displayName: true,
          firstName: true,
        },
      },
      posts: {
        where: {
          kind: "request",
        },
        select: {
          content: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  if (!thread || !thread.posts.length) {
    return {
      title: "Prayer Request Not Found - Forge",
    };
  }

  const mainPost = thread.posts[0];
  const authorName = thread.isAnonymous ? "Anonymous" : (thread.author?.displayName || thread.author?.firstName || "Unknown");
  const content = mainPost.content || "";
  const description = content.length > 160 
    ? content.substring(0, 157) + "..." 
    : content;

  return {
    title: "Prayer Request - Forge",
    description: `Prayer request by ${authorName}: ${description}`,
  };
}

export default async function ThreadPage({ params }: PageProps) {
  const { id } = await params;
  const { userId } = await auth();
  
  const thread = await prisma.thread.findUnique({
    where: { 
      id,
      deletedAt: null,
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
      group: {
        select: {
          id: true,
          name: true,
          groupType: true,
        },
      },
      posts: {
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
      },
      prayers: {
        select: {
          userId: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      _count: {
        select: {
          posts: true,
          prayers: true,
        },
      },
    },
  });

  if (!thread) {
    notFound();
  }

  // Check if user has access to this thread
  let hasAccess = false;
  let currentUser = null;
  let hasPrayed = false;

  if (userId) {
    currentUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      include: {
        memberships: thread.group ? {
          where: {
            groupId: thread.group.id,
            status: "active",
          },
        } : false, // Don't include memberships for community-only threads
      },
    });

    if (currentUser) {
      // Check if user is member of the group or thread is shared to community
      hasAccess = (currentUser.memberships && currentUser.memberships.length > 0) || thread.sharedToCommunity;

      // Check prayer status
      const userPrayer = await prisma.prayerAction.findFirst({
        where: {
          threadId: thread.id,
          userId: currentUser.id,
        },
      });
      hasPrayed = !!userPrayer;
    }
  } else {
    // Allow anonymous access to community threads
    hasAccess = thread.sharedToCommunity;
  }

  if (!hasAccess) {
    notFound();
  }

  // Sanitize data for client component
  const sanitizedThread = {
    id: thread.id,
    title: thread.title,
    sharedToCommunity: thread.sharedToCommunity,
    isAnonymous: thread.isAnonymous,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    author: thread.isAnonymous ? null : thread.author,
    group: thread.group,
    posts: thread.posts.map(post => ({
      ...post,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: thread.isAnonymous && post.authorId === thread.authorId ? null : post.author,
      reactions: post.reactions.map(reaction => ({
        ...reaction,
        createdAt: reaction.createdAt.toISOString(),
      })),
    })),
    prayers: thread.prayers.map(prayer => ({
      ...prayer,
      createdAt: prayer.createdAt.toISOString(),
    })),
    _count: thread._count,
  };

  const sanitizedCurrentUser = currentUser ? {
    id: currentUser.id,
    displayName: currentUser.displayName,
    firstName: currentUser.firstName,
    profileImageUrl: currentUser.profileImageUrl,
  } : null;

  return (
    <ThreadDetail 
      thread={sanitizedThread}
      currentUser={sanitizedCurrentUser}
      initialPrayerStatus={{
        hasPrayed,
        prayerCount: thread._count.prayers,
      }}
    />
  );
}
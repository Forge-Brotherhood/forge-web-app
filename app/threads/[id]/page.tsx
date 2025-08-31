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
  
  const thread = await prisma.prayerThread.findUnique({
    where: { id },
    select: {
      title: true,
      body: true,
      isAnonymous: true,
      author: {
        select: {
          displayName: true,
        },
      },
    },
  });

  if (!thread) {
    return {
      title: "Prayer Request Not Found - Forge",
    };
  }

  const authorName = thread.isAnonymous ? "Anonymous" : (thread.author?.displayName || "Unknown");
  const description = thread.body.length > 160 
    ? thread.body.substring(0, 157) + "..." 
    : thread.body;

  return {
    title: `${thread.title} - Forge Prayer Request`,
    description: `Prayer request by ${authorName}: ${description}`,
  };
}

export default async function ThreadPage({ params }: PageProps) {
  const { id } = await params;
  const { userId } = await auth();
  
  const thread = await prisma.prayerThread.findUnique({
    where: { id },
    include: {
      author: {
        select: {
          id: true,
          displayName: true,
          handle: true,
          avatarUrl: true,
        },
      },
      encouragements: {
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      updates: {
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      _count: {
        select: {
          prayers: true,
          encouragements: true,
          updates: true,
        },
      },
    },
  });

  if (!thread) {
    notFound();
  }

  // Get current user's prayer status and user data if authenticated
  let hasPrayed = false;
  let currentUser = null;

  if (userId) {
    currentUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: {
        id: true,
        displayName: true,
        handle: true,
        avatarUrl: true,
      },
    });

    if (currentUser) {
      const userPrayer = await prisma.prayer.findFirst({
        where: {
          threadId: thread.id,
          userId: currentUser.id,
        },
      });
      hasPrayed = !!userPrayer;
    }
  }

  // Hide author info if anonymous and convert dates to strings
  const sanitizedThread = {
    ...thread,
    author: thread.isAnonymous ? null : thread.author,
    createdAt: thread.createdAt.toISOString(),
    expiresAt: thread.expiresAt.toISOString(),
    encouragements: thread.encouragements.map(enc => ({
      ...enc,
      createdAt: enc.createdAt.toISOString(),
    })),
    updates: thread.updates.map(update => ({
      ...update,
      createdAt: update.createdAt.toISOString(),
    })),
  };

  return (
    <ThreadDetail 
      thread={sanitizedThread}
      currentUser={currentUser}
      initialPrayerStatus={{
        hasPrayed,
        prayerCount: thread._count.prayers,
      }}
    />
  );
}
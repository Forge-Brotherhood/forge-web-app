import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ThreadDetail } from "./thread-detail";

interface PageProps {
  params: Promise<{ id: string }>;
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
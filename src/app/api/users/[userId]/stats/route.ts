import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: currentUserId } = await auth();
    
    if (!currentUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;

    // Get user's threads count
    const totalThreads = await prisma.prayerRequest.count({
      where: { authorId: userId }
    });

    // Get total prayer actions received on user's threads
    const prayersReceived = await prisma.prayerAction.count({
      where: {
        request: {
          authorId: userId
        }
      }
    });

    // Get total encouragement posts received on user's threads
    const encouragementsReceived = await prisma.prayerEntry.count({
      where: {
        request: {
          authorId: userId
        },
        kind: 'encouragement'
      }
    });

    // Get active threads (open status)
    const activeThreads = await prisma.prayerRequest.count({
      where: {
        authorId: userId,
        status: 'open'
      }
    });

    // Get answered threads
    const answeredThreads = await prisma.prayerRequest.count({
      where: {
        authorId: userId,
        status: 'answered'
      }
    });

    return NextResponse.json({
      totalPrayers: totalThreads,
      prayersReceived,
      encouragementsReceived,
      activePrayers: activeThreads,
      resolvedPrayers: answeredThreads
    });

  } catch (error) {
    console.error("Error fetching user stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch user statistics" },
      { status: 500 }
    );
  }
}
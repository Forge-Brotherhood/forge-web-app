import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: currentUserId } = await auth();
    const { userId } = await params;
    
    if (!currentUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Users can only fetch their own stats
    if (currentUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get prayer count (threads created by user)
    const prayerCount = await prisma.prayerThread.count({
      where: {
        authorId: currentUserId,
      },
    });

    // Get encouragement count (encouragements created by user)
    const encouragementCount = await prisma.encouragement.count({
      where: {
        authorId: currentUserId,
      },
    });

    return NextResponse.json({
      prayerCount,
      encouragementCount,
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
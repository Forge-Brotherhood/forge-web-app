import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { faker } from "@faker-js/faker";

// Only enable in development
const isDev = process.env.NODE_ENV === "development";

export async function POST(request: NextRequest) {
  if (!isDev) {
    return NextResponse.json(
      { error: "Debug endpoints are only available in development" },
      { status: 403 }
    );
  }

  try {
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

    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case "createTestThread": {
        // Create a test thread shared to community
        const thread = await prisma.prayerRequest.create({
          data: {
            title: data?.title || faker.lorem.sentence(),
            authorId: user.id,
            sharedToCommunity: true,
            isAnonymous: data?.isAnonymous || false,
            status: "open",
            shortId: faker.string.alphanumeric(8),
            entries: {
              create: {
                kind: "request",
                content: data?.content || faker.lorem.paragraph(),
                authorId: user.id,
                shortId: faker.string.alphanumeric(8),
              },
            },
          },
          include: {
            entries: true,
            _count: {
              select: {
                entries: true,
                actions: true,
              },
            },
          },
        });

        return NextResponse.json({
          message: "Test thread created",
          threadId: thread.id,
          thread,
        });
      }

      case "resetPrayerStreak": {
        // Reset prayer streak
        await prisma.user.update({
          where: { id: user.id },
          data: {
            prayerStreak: 0,
            lastPrayerAt: null,
          },
        });

        return NextResponse.json({
          message: "Prayer streak reset",
        });
      }

      case "setPrayerStreak": {
        // Set custom prayer streak
        const streak = data?.streak || 7;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            prayerStreak: streak,
            lastPrayerAt: new Date(),
          },
        });

        return NextResponse.json({
          message: `Prayer streak set to ${streak}`,
          streak,
        });
      }

      case "clearAllData": {
        // Clear all user's threads and posts
        await prisma.prayerEntry.deleteMany({
          where: { authorId: user.id },
        });

        await prisma.prayerRequest.deleteMany({
          where: { authorId: user.id },
        });

        await prisma.prayerAction.deleteMany({
          where: { userId: user.id },
        });

        return NextResponse.json({
          message: "All user data cleared",
        });
      }

      case "generateTestData": {
        // Generate random test threads
        const numThreads = data?.numThreads || 5;
        const threads = [];

        for (let i = 0; i < numThreads; i++) {
          const thread = await prisma.prayerRequest.create({
            data: {
              title: faker.lorem.sentence(),
              authorId: user.id,
              sharedToCommunity: true,
              isAnonymous: faker.datatype.boolean(),
              status: faker.helpers.arrayElement(["open", "answered", "archived"]),
              shortId: faker.string.alphanumeric(8),
              entries: {
                create: {
                  kind: "request",
                  content: faker.lorem.paragraphs(2),
                  authorId: user.id,
                  shortId: faker.string.alphanumeric(8),
                },
              },
            },
          });
          threads.push(thread);
        }

        return NextResponse.json({
          message: `Generated ${numThreads} test threads`,
          threads: threads.map(t => t.id),
        });
      }

      case "toggleSponsor": {
        // Toggle sponsor status
        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: {
            isSponsor: !user.isSponsor,
          },
        });

        return NextResponse.json({
          message: `Sponsor status ${updatedUser.isSponsor ? "enabled" : "disabled"}`,
          isSponsor: updatedUser.isSponsor,
        });
      }

      case "getDebugInfo": {
        // Get comprehensive debug information
        const debugInfo = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            prayerRequestsAuthored: {
              take: 5,
              orderBy: { createdAt: "desc" },
            },
            prayerActions: {
              take: 5,
              orderBy: { createdAt: "desc" },
            },
            userReadingPlans: {
              take: 5,
              orderBy: { createdAt: "desc" },
              include: {
                template: true,
              },
            },
            _count: {
              select: {
                prayerRequestsAuthored: true,
                prayerEntriesAuthored: true,
                prayerActions: true,
                prayerResponses: true,
                userReadingPlans: true,
              },
            },
          },
        });

        return NextResponse.json(debugInfo);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Debug API error:", error);
    return NextResponse.json(
      { error: "Debug operation failed" },
      { status: 500 }
    );
  }
}

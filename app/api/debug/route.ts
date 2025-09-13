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
      case "joinCoreGroup": {
        // Create or join a core group
        const existingMembership = await prisma.groupMember.findFirst({
          where: {
            userId: user.id,
            group: { groupType: "core" },
            status: "active",
          },
        });

        if (existingMembership) {
          return NextResponse.json({
            message: "Already in a core group",
            groupId: existingMembership.groupId,
          });
        }

        // Find a core group with space or create new one
        let group = await prisma.group.findFirst({
          where: {
            groupType: "core",
            members: {
              every: { status: "active" },
            },
          },
          include: {
            _count: {
              select: { members: { where: { status: "active" } } },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (!group || group._count.members >= 6) {
          // Create new core group
          const newGroup = await prisma.group.create({
            data: {
              name: `Core Group ${faker.company.buzzNoun()}`,
              groupType: "core",
              shortId: faker.string.alphanumeric(8),
            },
          });

          // Fetch with proper includes to match the type
          group = await prisma.group.findUnique({
            where: { id: newGroup.id },
            include: {
              _count: {
                select: { members: { where: { status: "active" } } },
              },
            },
          });
        }

        if (!group) {
          throw new Error("Failed to create or find group");
        }

        // Add user to group
        await prisma.groupMember.create({
          data: {
            groupId: group.id,
            userId: user.id,
            role: group._count.members === 0 ? "leader" : "member",
            status: "active",
          },
        });

        // Add some fake members if it's a new group
        if (group._count.members === 0 && data?.addFakeMembers) {
          const fakeUsers = await prisma.user.findMany({
            where: {
              id: { not: user.id },
              memberships: {
                none: {
                  group: { groupType: "core" },
                  status: "active",
                },
              },
            },
            take: 4,
          });

          for (const fakeUser of fakeUsers) {
            await prisma.groupMember.create({
              data: {
                groupId: group.id,
                userId: fakeUser.id,
                role: "member",
                status: "active",
              },
            });
          }
        }

        return NextResponse.json({
          message: "Joined core group successfully",
          groupId: group.id,
          groupName: group.name,
        });
      }

      case "joinCircleGroup": {
        // Create or join a prayer circle
        const existingMembership = await prisma.groupMember.findFirst({
          where: {
            userId: user.id,
            group: { groupType: "circle" },
            status: "active",
          },
        });

        if (existingMembership) {
          return NextResponse.json({
            message: "Already in a prayer circle",
            groupId: existingMembership.groupId,
          });
        }

        // Find or create a circle group
        let group = await prisma.group.findFirst({
          where: {
            groupType: "circle",
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (!group) {
          group = await prisma.group.create({
            data: {
              name: `Prayer Circle ${faker.company.buzzAdjective()}`,
              groupType: "circle",
              shortId: faker.string.alphanumeric(8),
            },
          });
        }

        // Add user to group as leader if group was just created
        const existingMember = await prisma.groupMember.findUnique({
          where: {
            groupId_userId: {
              groupId: group.id,
              userId: user.id,
            },
          },
        });

        if (!existingMember) {
          await prisma.groupMember.create({
            data: {
              groupId: group.id,
              userId: user.id,
              role: "leader",
              status: "active",
            },
          });
        }

        return NextResponse.json({
          message: "Joined prayer circle successfully",
          groupId: group.id,
          groupName: group.name,
        });
      }

      case "leaveAllGroups": {
        // Remove user from all groups
        await prisma.groupMember.updateMany({
          where: { userId: user.id },
          data: { status: "inactive" },
        });

        return NextResponse.json({
          message: "Left all groups successfully",
        });
      }

      case "createTestThread": {
        // Create a test thread in user's core group
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId: user.id,
            group: { groupType: "core" },
            status: "active",
          },
        });

        if (!membership) {
          return NextResponse.json(
            { error: "Not in a core group" },
            { status: 400 }
          );
        }

        const thread = await prisma.prayerRequest.create({
          data: {
            title: data?.title || faker.lorem.sentence(),
            groupId: membership.groupId,
            authorId: user.id,
            sharedToCommunity: data?.sharedToCommunity || false,
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
        // Generate random test data
        const group = await prisma.groupMember.findFirst({
          where: {
            userId: user.id,
            group: { groupType: "core" },
            status: "active",
          },
          include: { group: true },
        });

        if (!group) {
          return NextResponse.json(
            { error: "Not in a core group" },
            { status: 400 }
          );
        }

        const numThreads = data?.numThreads || 5;
        const threads = [];

        for (let i = 0; i < numThreads; i++) {
          const thread = await prisma.prayerRequest.create({
            data: {
              title: faker.lorem.sentence(),
              groupId: group.groupId,
              authorId: user.id,
              sharedToCommunity: faker.datatype.boolean(),
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
            memberships: {
              include: {
                group: {
                  include: {
                    _count: {
                      select: {
                        members: true,
                        prayerRequests: true,
                      },
                    },
                  },
                },
              },
            },
            prayerRequestsAuthored: {
              take: 5,
              orderBy: { createdAt: "desc" },
            },
            prayerActions: {
              take: 5,
              orderBy: { createdAt: "desc" },
            },
            _count: {
              select: {
                prayerRequestsAuthored: true,
                prayerEntriesAuthored: true,
                prayerActions: true,
                prayerResponses: true,
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
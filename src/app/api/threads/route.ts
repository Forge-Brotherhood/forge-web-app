import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

const createThreadSchema = z.object({
  groupId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1),
  postKind: z.enum(["request", "update", "testimony"]).default("request"),
  sharedToCommunity: z.boolean().default(false),
  isAnonymous: z.boolean().default(false),
  // New approach: support both attachmentIds and mediaUrls (back-compat name kept)
  mediaIds: z.array(z.string()).optional(), // Array of Attachment record IDs for videos
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
    uploadId: z.string().optional(),
    filename: z.string().optional(),
  })).optional(),
});

// GET /api/threads - List threads (core group, circle, or community)
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId"); // Specific group ID filter
    const source = searchParams.get("source") || "core"; // core | circle | community
    const status = searchParams.get("status"); // Optional status filter
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      include: {
        memberships: {
          where: {
            status: "active",
          },
          include: {
            group: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    let whereClause: any = {
      deletedAt: null,
    };

    // Only add status filter if explicitly provided
    if (status) {
      whereClause.status = status as any;
    }

    // If groupId is provided, filter by that specific group
    if (groupId) {
      // Resolve id or shortId to the actual group
      const resolvedGroup = await prisma.group.findFirst({
        where: {
          OR: [{ id: groupId }, { shortId: groupId }],
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!resolvedGroup) {
        return NextResponse.json(
          { error: "Group not found" },
          { status: 404 }
        );
      }

      // Verify user is a member of this group
      const isMember = user.memberships.some(m => m.groupId === resolvedGroup.id);
      if (!isMember) {
        return NextResponse.json(
          { error: "Not a member of this group" },
          { status: 403 }
        );
      }
      whereClause.groupId = resolvedGroup.id;
    } else if (source === "core") {
      // Get threads from user's core group
      const coreGroup = user.memberships.find(m => m.group.groupType === "core");
      if (!coreGroup) {
        return NextResponse.json({ threads: [], totalCount: 0, hasMore: false });
      }
      whereClause.groupId = coreGroup.groupId;
    } else if (source === "circle") {
      // Get threads from all user's circle groups
      const circleGroupIds = user.memberships
        .filter(m => m.group.groupType === "circle")
        .map(m => m.groupId);
      whereClause.groupId = { in: circleGroupIds };
    } else if (source === "community") {
      // Get threads shared to community
      whereClause.sharedToCommunity = true;
    }

    const [threads, totalCount] = await Promise.all([
      prisma.prayerRequest.findMany({
        where: whereClause,
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
          entries: {
            where: {
              kind: "request",
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
            include: {
              attachments: true,
              author: {
                select: {
                  id: true,
                  displayName: true,
                  firstName: true,
                  profileImageUrl: true,
                },
              },
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
            },
          },
          // Include saved prayers for current user
          savedBy: {
            where: {
              userId: user.id,
            },
            select: {
              id: true,
              entryId: true,
            },
            take: 1, // We only need to know if it exists
          },
          // Include prayer actions for current user
          actions: {
            where: {
              userId: user.id,
            },
            select: {
              id: true,
            },
            take: 1, // We only need to know if it exists
          },
          _count: {
            select: {
              entries: true,
              actions: true,
              savedBy: true,
            },
          },
        },
        orderBy: {
          lastActivityAt: "desc",
        },
        take: limit,
        skip: offset,
      }),
      prisma.prayerRequest.count({ where: whereClause }),
    ]);

    // Sanitize anonymous threads and add prayer list status
    const sanitizedThreads = threads.map(thread => ({
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    }));

    return NextResponse.json({
      threads: sanitizedThreads,
      totalCount,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    console.error("Error fetching threads:", error);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 }
    );
  }
}

// POST /api/threads - Create a new thread with initial post
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    console.log('Received request body:', body);
    
    // Legacy support: transform 'body' field to 'content'
    if (body.body && !body.content) {
      body.content = body.body;
    }
    
    // Get user with memberships
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      include: {
        memberships: {
          where: { status: "active" },
          include: { group: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }
    
    // If no groupId provided (undefined), find user's core group or first active group
    // Note: null means explicitly community-only, undefined means auto-assign
    if (body.groupId === undefined) {
      const coreGroup = user.memberships.find(m => m.group.groupType === "core");
      const activeGroup = coreGroup || user.memberships[0];
      
      if (activeGroup) {
        body.groupId = activeGroup.groupId;
        // If posting to community without explicit setting, default to true
        if (body.sharedToCommunity === undefined) {
          body.sharedToCommunity = true;
        }
      } else {
        // User has no group memberships - only allow community-only posts
        if (!body.sharedToCommunity) {
          return NextResponse.json(
            { error: "Users without group memberships can only post to the community. Set sharedToCommunity to true." },
            { status: 400 }
          );
        }
        // Allow community-only post by setting groupId to null
        body.groupId = null;
      }
    }
    
    console.log('Final body before validation:', body);
    
    const validatedData = createThreadSchema.parse(body);

    // Verify user is member of the group (skip for community-only posts)
    if (validatedData.groupId) {
      const membership = await prisma.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: validatedData.groupId,
            userId: user.id,
          },
        },
      });

      if (!membership || membership.status !== "active") {
        return NextResponse.json(
          { error: "Not a member of this group" },
          { status: 403 }
        );
      }
    }

    // Create request with initial entry in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.prayerRequest.create({
        data: {
          shortId: nanoid(12),
          groupId: validatedData.groupId || undefined,
          authorId: user.id,
          title: validatedData.title,
          sharedToCommunity: validatedData.sharedToCommunity,
          isAnonymous: validatedData.isAnonymous,
          status: "open",
        },
      });

      const entry = await tx.prayerEntry.create({
        data: {
          shortId: nanoid(12),
          requestId: request.id,
          authorId: user.id,
          kind: validatedData.postKind as any,
          content: validatedData.content,
        },
        include: {
          attachments: true,
        },
      });

      // Handle linking existing Attachment records (new approach for videos)
      if (validatedData.mediaIds && validatedData.mediaIds.length > 0) {
        const attachments = await tx.attachment.findMany({
          where: {
            id: { in: validatedData.mediaIds },
          },
        });

        console.log(`Found ${attachments.length} attachments to link to entry ${entry.id}`);
        
        if (attachments.length > 0) {
          await tx.attachment.updateMany({
            where: { id: { in: attachments.map(a => a.id) } },
            data: { entryId: entry.id },
          });
          console.log(`✅ Linked ${attachments.length} attachments to entry ${entry.id}`);
        }
      }

      // Handle creating new Attachment records (backward compatibility for images)
      if (validatedData.mediaUrls && validatedData.mediaUrls.length > 0) {
        await tx.attachment.createMany({
          data: validatedData.mediaUrls.map(media => ({
            entryId: entry.id,
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

      return { request, entry };
    });

    const fullThread = await prisma.prayerRequest.findUnique({
      where: { id: result.request.id },
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
        entries: {
          include: {
            attachments: true,
            responses: true,
          },
        },
        _count: {
          select: {
            entries: true,
            actions: true,
          },
        },
      },
    });

    // Sanitize if anonymous
    const sanitizedThread = fullThread ? {
      ...fullThread,
      author: fullThread.isAnonymous ? null : fullThread.author,
      posts: fullThread.entries.map(e => ({
        ...e,
        media: e.attachments,
        reactions: e.responses,
        _count: { prayerActions: (e as any)._count?.actions ?? 0 },
      })),
    } : null;

    return NextResponse.json(sanitizedThread, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating thread:", error);
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    );
  }
}
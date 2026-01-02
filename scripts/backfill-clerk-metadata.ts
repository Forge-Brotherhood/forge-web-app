/**
 * Backfill Script: Set dbUserId in Clerk Metadata
 *
 * This script updates existing Clerk users with their internal database user ID
 * in publicMetadata. This enables fast auth lookups without database queries.
 *
 * Run with: npx tsx scripts/backfill-clerk-metadata.ts
 */

import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "../src/lib/prisma";

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

async function backfill() {
  console.log("Starting Clerk metadata backfill...\n");

  // Get all users from database
  const users = await prisma.user.findMany({
    select: { id: true, clerkId: true, email: true },
  });

  console.log(`Found ${users.length} users to process\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      // Check if user already has metadata set
      const clerkUser = await clerk.users.getUser(user.clerkId);
      const existingDbUserId = clerkUser.publicMetadata?.dbUserId;

      if (existingDbUserId === user.id) {
        console.log(`[SKIP] ${user.email} - already has correct dbUserId`);
        skipCount++;
        continue;
      }

      // Update Clerk metadata
      await clerk.users.updateUserMetadata(user.clerkId, {
        publicMetadata: {
          dbUserId: user.id,
        },
      });

      console.log(`[OK] ${user.email} - set dbUserId to ${user.id}`);
      successCount++;
    } catch (error: any) {
      console.error(`[ERROR] ${user.email} (${user.clerkId}):`, error.message);
      errorCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log("\n--- Backfill Complete ---");
  console.log(`Success: ${successCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total: ${users.length}`);

  await prisma.$disconnect();
}

backfill().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

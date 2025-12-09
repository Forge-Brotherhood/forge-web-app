/**
 * Auth Utility
 *
 * Provides fast authentication by extracting the DB user ID from Clerk session claims.
 * Falls back to database lookup for users without metadata (during migration).
 */

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export interface AuthResult {
  userId: string; // Internal DB user ID
  clerkId: string; // Clerk user ID
}

/**
 * Get authenticated user info with DB user ID from session claims.
 * Returns null if not authenticated or user not found.
 */
export async function getAuth(): Promise<AuthResult | null> {
  const { userId: clerkId, sessionClaims } = await auth();

  if (!clerkId) return null;

  // Fast path: get dbUserId from session claims (set via Clerk metadata)
  const dbUserId = sessionClaims?.dbUserId as string | undefined;

  if (dbUserId) {
    return { userId: dbUserId, clerkId };
  }

  // Fallback: DB lookup for users without metadata (legacy/migration period)
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });

  if (!user) return null;

  return { userId: user.id, clerkId };
}

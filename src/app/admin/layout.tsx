/**
 * Admin Layout
 *
 * Wraps all admin pages with authentication and role checking.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    redirect("/sign-in");
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { role: true },
  });

  if (!user || user.role !== "admin") {
    redirect("/");
  }

  return <div className="min-h-screen bg-background">{children}</div>;
}

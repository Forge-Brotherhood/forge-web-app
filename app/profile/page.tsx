import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ProfileContent } from "./profile-content";
import { prisma } from "@/lib/prisma";

export default async function ProfilePage() {
  const { userId } = await auth();
  
  if (!userId) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      id: true,
      displayName: true,
      handle: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
      role: true,
      threads: {
        select: {
          id: true,
        },
      },
      prayers: {
        select: {
          id: true,
        },
      },
      encouragements: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    redirect("/");
  }

  const stats = {
    prayerRequests: user.threads.length,
    prayersGiven: user.prayers.length,
    encouragements: user.encouragements.length,
  };

  return (
    <div className="container max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Profile</h1>
      <ProfileContent 
        user={{
          id: user.id,
          displayName: user.displayName || "",
          handle: user.handle || "",
          email: user.email || "",
          avatarUrl: user.avatarUrl || "",
          createdAt: user.createdAt,
          role: user.role,
        }}
        stats={stats}
      />
    </div>
  );
}



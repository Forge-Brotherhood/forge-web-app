import { CreatePrayer } from "@/components/create-prayer";
import { PrayerCard } from "@/components/prayer-card";
import { Navbar } from "@/components/navbar";
import { SignInButton } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auth } from "@clerk/nextjs/server";

// Mock data for demonstration
const mockPrayers = [
  {
    id: "1",
    author: { name: "Sarah Johnson" },
    content: "Please pray for my grandmother who is in the hospital recovering from surgery. She's been struggling with her health, and we're hoping for a full recovery. Any prayers for strength and healing would be deeply appreciated.",
    prayerCount: 23,
    commentCount: 8,
    createdAt: "2 hours ago",
    isAnonymous: false,
  },
  {
    id: "2",
    author: { name: "Anonymous" },
    content: "I'm facing a difficult decision about my career and feel lost. Please pray for wisdom and guidance as I navigate this challenging time. I need clarity about which path to take.",
    prayerCount: 15,
    commentCount: 3,
    createdAt: "4 hours ago",
    isAnonymous: true,
  },
  {
    id: "3",
    author: { name: "Michael Chen" },
    content: "Our church is organizing a food drive for families in need this month. Please pray that we can reach our goal and make a meaningful impact in our community. Also praying for all the families who will benefit from this outreach.",
    prayerCount: 45,
    commentCount: 12,
    createdAt: "6 hours ago",
    isAnonymous: false,
  },
];

export default async function Home() {
  const { userId } = await auth();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-2xl mx-auto py-6 px-4">
        <div className="space-y-6">
          {!userId ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Welcome to Forge</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-6">
                  Join our prayer community to share requests, support others, and experience the power of collective prayer.
                </p>
                <SignInButton mode="redirect">
                  <Button size="lg" className="w-full">
                    Sign In to Continue
                  </Button>
                </SignInButton>
              </CardContent>
            </Card>
          ) : null}
          
          <CreatePrayer />
          
          {userId ? (
            <div className="space-y-4">
              {mockPrayers.map((prayer) => (
                <PrayerCard key={prayer.id} {...prayer} />
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
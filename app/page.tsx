import { CreatePrayer } from "@/components/create-prayer";
import { PrayerThreadList } from "@/components/prayer-thread-list";
import { Navbar } from "@/components/navbar";
import { SignInButton } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auth } from "@clerk/nextjs/server";

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
          
          {userId ? <PrayerThreadList /> : null}
        </div>
      </main>
    </div>
  );
}
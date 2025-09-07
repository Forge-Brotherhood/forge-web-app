"use client";

import { useAuth } from "@clerk/nextjs";
import { Sidebar } from "@/components/sidebar";

interface ConditionalLayoutProps {
  children: React.ReactNode;
}

export function ConditionalLayout({ children }: ConditionalLayoutProps) {
  const { isSignedIn, isLoaded } = useAuth();

  // Always render the same structure to prevent hook ordering issues
  return (
    <>
      {isSignedIn && isLoaded && <Sidebar />}
      <main className={isSignedIn && isLoaded ? "md:ml-20 min-h-screen pb-24 md:pb-0" : "min-h-screen"}>
        {!isLoaded ? (
          <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
"use client";

import { useAuth } from "@clerk/nextjs";
import { Sidebar } from "@/components/sidebar";

interface ConditionalLayoutProps {
  children: React.ReactNode;
}

export function ConditionalLayout({ children }: ConditionalLayoutProps) {
  const { isSignedIn, isLoaded } = useAuth();

  // Show loading state while auth is loading
  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If user is signed in, show normal layout with sidebar
  if (isSignedIn) {
    return (
      <>
        <Sidebar />
        <main className="md:ml-20 min-h-screen pb-24 md:pb-0">
          {children}
        </main>
      </>
    );
  }

  // If user is not signed in, show children without sidebar (for auth pages)
  return (
    <main className="min-h-screen">
      {children}
    </main>
  );
}
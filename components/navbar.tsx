"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignedIn, UserButton, useAuth } from "@clerk/nextjs";

export function Navbar() {
  const { isLoaded } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container max-w-2xl mx-auto flex h-14 items-center px-4">
        <div className="mr-6 flex">
          <Link href="/" className="flex items-center">
            <span className="font-semibold text-base">Forge</span>
          </Link>
        </div>
        
        <div className="flex flex-1 items-center justify-end space-x-2">
          <ThemeToggle />
          {isLoaded ? (
            <SignedIn>
              <UserButton />
            </SignedIn>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          )}
        </div>
      </div>
    </header>
  );
}
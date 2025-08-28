"use client";

import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignedIn, UserButton, useAuth } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function Navbar() {
  const { isLoaded } = useAuth();
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? systemTheme : theme;
  const logoSrc = currentTheme === "dark" 
    ? "/forge-logo-dark.svg" 
    : "/forge-logo-light.svg";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container max-w-2xl mx-auto flex h-14 items-center px-4">
        <div className="mr-6 flex">
          <Link href="/" className="flex items-center">
            {mounted ? (
              <Image 
                src={logoSrc} 
                alt="Forge" 
                width={80} 
                height={32}
                className="h-6 w-auto"
                priority
              />
            ) : (
              <div className="h-6 w-20 animate-pulse bg-muted rounded" />
            )}
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
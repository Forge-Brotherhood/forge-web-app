"use client";

import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignedIn, useAuth, useUser } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile";

export function Navbar() {
  const { isLoaded } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { profile } = useProfile();
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? systemTheme : theme;
  const logoSrc = currentTheme === "dark" 
    ? "/forge-logo-dark.svg" 
    : "/forge-logo-light.svg";

  const getInitials = () => {
    // Use profile displayName first, then fall back to Clerk data
    if (profile?.displayName) {
      return profile.displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.firstName) {
      const names = [user.firstName, user.lastName].filter(Boolean);
      return names
        .map((name) => name![0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || "U";
  };

  const handleSignOut = async () => {
    await signOut();
  };

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="relative h-8 w-8 rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
                    aria-label="User menu"
                  >
                    <Avatar className="h-8 w-8 cursor-pointer">
                      <AvatarImage src={profile?.avatarUrl || user?.imageUrl} alt={profile?.displayName || user?.firstName || "User"} />
                      <AvatarFallback>{getInitials()}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {profile?.displayName || user?.firstName || "User"}
                      </p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {profile?.email || user?.primaryEmailAddress?.emailAddress}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleSignOut}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SignedIn>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          )}
        </div>
      </div>
    </header>
  );
}
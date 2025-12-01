"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function AuthHandler() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const prevSignedIn = useRef<boolean | null>(null);

  useEffect(() => {
    if (isLoaded && prevSignedIn.current !== null && prevSignedIn.current !== isSignedIn) {
      // Authentication state changed, refresh the router cache
      router.refresh();
    }
    
    if (isLoaded) {
      prevSignedIn.current = isSignedIn;
    }
  }, [isSignedIn, isLoaded, router]);

  return null;
}
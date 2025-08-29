"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

interface UserProfile {
  id: string;
  displayName: string | null;
  handle: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}

export function useProfile() {
  const { userId, isLoaded } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    
    if (!userId) {
      setProfile(null);
      setIsLoadingProfile(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        const response = await fetch("/api/profile");
        if (response.ok) {
          const data = await response.json();
          setProfile(data);
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setIsLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [userId, isLoaded]);

  return { profile, isLoadingProfile };
}


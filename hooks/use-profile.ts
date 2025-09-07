"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

interface GroupMembership {
  groupId: string;
  role: string;
  group: {
    id: string;
    name: string | null;
    groupType: 'core' | 'circle';
  };
}

interface UserProfile {
  id: string;
  displayName: string | null;
  handle: string | null;
  email: string | null;
  avatarUrl: string | null;
  profileImageUrl: string | null;
  role: string;
  memberships: GroupMembership[];
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

  // Utility functions for group membership
  const getActiveGroups = () => profile?.memberships || [];
  
  const getCoreGroups = () => getActiveGroups().filter(m => m.group.groupType === 'core');
  
  const getCircleGroups = () => getActiveGroups().filter(m => m.group.groupType === 'circle');
  
  const hasActiveGroups = () => getActiveGroups().length > 0;
  
  const canPostToGroups = () => hasActiveGroups();
  
  const getPrimaryGroup = () => {
    const groups = getActiveGroups();
    // Prefer core group, fallback to first available
    return getCoreGroups()[0] || groups[0] || null;
  };

  const getPostingOptions = () => {
    const hasGroups = hasActiveGroups();
    return {
      canPostToGroups: hasGroups,
      canPostToCommunity: true, // Everyone can post to community
      communityOnly: !hasGroups, // Users without groups can only post to community
      groups: getActiveGroups(),
    };
  };

  return { 
    profile, 
    isLoadingProfile,
    getActiveGroups,
    getCoreGroups,
    getCircleGroups,
    hasActiveGroups,
    canPostToGroups,
    getPrimaryGroup,
    getPostingOptions,
  };
}


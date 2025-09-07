"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

interface UpdateProfileParams {
  displayName?: string;
  handle?: string;
}

// Query keys
export const profileKeys = {
  all: ['profile'] as const,
  detail: () => [...profileKeys.all, 'detail'] as const,
} as const;

// Fetch profile function
const fetchProfile = async (): Promise<UserProfile> => {
  const response = await fetch("/api/profile");
  
  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }
  
  return response.json();
};

// Profile query hook
export function useProfile() {
  const { userId, isLoaded } = useAuth();
  
  const {
    data: profile,
    isLoading: isLoadingProfile,
    error,
    refetch,
  } = useQuery({
    queryKey: profileKeys.detail(),
    queryFn: fetchProfile,
    enabled: isLoaded && !!userId, // Only fetch when user is authenticated
    staleTime: 5 * 60 * 1000, // Consider profile fresh for 5 minutes
    gcTime: 15 * 60 * 1000, // Keep profile in cache for 15 minutes
    retry: 2,
  });

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
    error: error ? (error as Error).message : null,
    refetch,
    getActiveGroups,
    getCoreGroups,
    getCircleGroups,
    hasActiveGroups,
    canPostToGroups,
    getPrimaryGroup,
    getPostingOptions,
  };
}

// Profile update mutation hook
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: UpdateProfileParams): Promise<UserProfile> => {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.status}`);
      }

      return response.json();
    },

    // Optimistic update
    onMutate: async (newProfile) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: profileKeys.detail() });

      // Snapshot the previous value
      const previousProfile = queryClient.getQueryData(profileKeys.detail());

      // Optimistically update the cache
      queryClient.setQueryData(profileKeys.detail(), (old: UserProfile | undefined) => {
        if (!old) return old;
        return { ...old, ...newProfile };
      });

      return { previousProfile };
    },

    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, newProfile, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(profileKeys.detail(), context.previousProfile);
      }
    },

    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail() });
    },
  });
}

// Avatar upload mutation hook
export function useUploadAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData): Promise<{ profileImageUrl: string }> => {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload avatar: ${response.status}`);
      }

      return response.json();
    },

    onSuccess: (data) => {
      // Update the profile cache with the new avatar URL
      queryClient.setQueryData(profileKeys.detail(), (old: UserProfile | undefined) => {
        if (!old) return old;
        return { ...old, profileImageUrl: data.profileImageUrl };
      });
    },

    onSettled: () => {
      // Ensure fresh data after upload
      queryClient.invalidateQueries({ queryKey: profileKeys.detail() });
    },
  });
}
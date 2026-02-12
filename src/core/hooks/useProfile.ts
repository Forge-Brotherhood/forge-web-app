"use client";

/**
 * Profile Hook
 * Manages user profile data with React Query.
 * Uses forgeApi for typed API calls.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { forgeApi } from "@core/api/forgeApiClient";
import { config } from "@core/services/configService";
import type { APIProfileResponse } from "@core/models/apiModels";

// MARK: - Query Keys

export const profileKeys = {
  all: ['profile'] as const,
  detail: () => [...profileKeys.all, 'detail'] as const,
} as const;

// MARK: - Types

interface UpdateProfileParams {
  displayName?: string;
  handle?: string;
}

// MARK: - Profile Query Hook

export function useProfile() {
  const { userId, isLoaded } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading: isLoadingProfile,
    error,
    refetch,
  } = useQuery({
    queryKey: profileKeys.detail(),
    queryFn: () => forgeApi.getProfile(),
    enabled: isLoaded && !!userId,
    staleTime: config.cacheStaleTime,
    gcTime: config.cacheGcTime,
    retry: 2,
  });

  // Prefetch profile for faster navigation
  const prefetchProfile = () => {
    queryClient.prefetchQuery({
      queryKey: profileKeys.detail(),
      queryFn: () => forgeApi.getProfile(),
      staleTime: config.cacheStaleTime,
    });
  };

  return {
    profile,
    isLoadingProfile,
    error: error ? (error as Error).message : null,
    refetch,
    prefetchProfile,
  };
}

// MARK: - Profile Update Mutation

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: UpdateProfileParams): Promise<APIProfileResponse> => {
      return forgeApi.updateProfile(updates);
    },

    // Optimistic update
    onMutate: async (newProfile) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.detail() });

      const previousProfile = queryClient.getQueryData<APIProfileResponse>(profileKeys.detail());

      queryClient.setQueryData<APIProfileResponse>(profileKeys.detail(), (old) => {
        if (!old) return old;
        return { ...old, ...newProfile };
      });

      return { previousProfile };
    },

    onError: (_err, _newProfile, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(profileKeys.detail(), context.previousProfile);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail() });
    },
  });
}

// MARK: - Avatar Upload Mutation

export function useUploadAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData): Promise<{ profileImageUrl: string }> => {
      return forgeApi.uploadAvatar(formData);
    },

    onSuccess: (data) => {
      queryClient.setQueryData<APIProfileResponse>(profileKeys.detail(), (old) => {
        if (!old) return old;
        return { ...old, profileImageUrl: data.profileImageUrl };
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail() });
    },
  });
}

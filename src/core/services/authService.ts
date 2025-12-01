"use client";

/**
 * Auth Service
 * Wrapper around Clerk authentication.
 * Mirrors iOS ClerkManager.swift pattern.
 */

import { useAuth as useClerkAuth, useUser as useClerkUser } from '@clerk/nextjs';

// MARK: - Auth State Types

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  userId: string | null;
}

export interface UserInfo {
  id: string;
  email: string | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  fullName: string | null | undefined;
  imageUrl: string | undefined;
}

// MARK: - Auth Hooks

/**
 * Hook to get authentication state
 * Wraps Clerk's useAuth with a consistent interface
 */
export function useAuthState(): AuthState {
  const { userId, isLoaded, isSignedIn } = useClerkAuth();

  return {
    isAuthenticated: isLoaded && !!isSignedIn,
    isLoading: !isLoaded,
    userId: userId ?? null,
  };
}

/**
 * Hook to get current user info
 * Returns undefined if not authenticated or still loading
 */
export function useCurrentUser(): { user: UserInfo | undefined; isLoading: boolean } {
  const { user, isLoaded } = useClerkUser();

  if (!isLoaded) {
    return { user: undefined, isLoading: true };
  }

  if (!user) {
    return { user: undefined, isLoading: false };
  }

  return {
    user: {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      imageUrl: user.imageUrl,
    },
    isLoading: false,
  };
}

/**
 * Hook to get sign out function
 */
export function useSignOut() {
  const { signOut } = useClerkAuth();
  return signOut;
}

// MARK: - Re-exports

// Re-export Clerk hooks for direct use when needed
export { useAuth, useUser, useClerk, useSession } from '@clerk/nextjs';

// Re-export auth components
export { SignIn, SignUp, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

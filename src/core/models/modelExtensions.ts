/**
 * Model Extensions
 * Conversion functions to transform API response models to domain models.
 * Mirrors iOS ModelExtensions.swift pattern.
 */

import type { User } from './models';
import type { APIProfileResponse } from './apiModels';

// MARK: - Date Parsing

/**
 * Parse ISO8601 date string to Date object
 * Handles both formats with and without fractional seconds
 */
export function parseDate(dateString: string | undefined | null): Date {
  if (!dateString) return new Date();

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  } catch {
    return new Date();
  }
}

// MARK: - Profile Conversion

export function apiProfileToUser(api: APIProfileResponse): User {
  return {
    id: api.id,
    clerkId: '', // Not included in profile response
    email: api.email,
    firstName: api.firstName,
    lastName: api.lastName,
    displayName: api.displayName,
    handle: api.handle,
    profileImageUrl: api.profileImageUrl,
    prayerStreak: api.prayerStreak ?? 0,
    lastPrayerAt: undefined,
    createdAt: parseDate(api.createdAt),
    updatedAt: new Date(),
  };
}

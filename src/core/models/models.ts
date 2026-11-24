/**
 * Core Domain Models
 * These models represent the application's domain entities.
 * They are separate from API response types to allow for clean data transformation.
 */

// MARK: - User

export interface User {
  id: string;
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  handle?: string;
  profileImageUrl?: string;
  prayerStreak: number;
  lastPrayerAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Helper functions for User */
export const UserHelpers = {
  getFullName(user: User): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  },

  getDisplayNameOrFallback(user: User): string {
    if (user.displayName && user.displayName.length > 0) return user.displayName;
    const fullName = UserHelpers.getFullName(user);
    if (fullName.length > 0) return fullName;
    return user.email;
  },

  getInitials(user: User): string {
    const fullName = UserHelpers.getFullName(user);
    const words = fullName.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    } else if (user.firstName && user.firstName.length > 0) {
      return user.firstName[0].toUpperCase();
    }
    return '?';
  },
};

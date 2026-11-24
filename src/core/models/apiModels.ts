/**
 * API Response Models
 * These models match the backend API response structures exactly.
 * They should be converted to domain models for use in the UI.
 */

// MARK: - Profile API

export interface APIProfileResponse {
  id: string;
  email: string;
  displayName?: string;
  handle?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  createdAt: string;
  role: string;
  prayerStreak?: number;
}

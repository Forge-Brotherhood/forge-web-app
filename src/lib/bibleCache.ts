/**
 * Bible Cache Configuration
 *
 * Manages TTL and helper functions for caching Bible data from API.Bible
 * in PostgreSQL to reduce external API calls.
 */

export const BIBLE_CACHE_CONFIG = {
  /** Cache TTL in days */
  TTL_DAYS: 30,

  /** Get expiration date (30 days from now) */
  getTTL: (): Date => {
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  },

  /** Check if a cached entry is still valid */
  isValid: (expiresAt: Date): boolean => {
    return new Date() < expiresAt;
  },
};

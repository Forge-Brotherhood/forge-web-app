/**
 * Configuration Service
 * Centralized configuration and environment settings.
 * Mirrors iOS Configuration.swift pattern.
 */

// MARK: - Environment Type

export type Environment = 'development' | 'staging' | 'production';

// MARK: - Config Service Class

class ConfigService {
  private static instance: ConfigService;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static get shared(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  // MARK: - Environment

  /**
   * Current environment
   */
  get environment(): Environment {
    if (process.env.NODE_ENV === 'development') return 'development';
    if (process.env.NEXT_PUBLIC_ENV === 'staging') return 'staging';
    return 'production';
  }

  /**
   * Check if running in development
   */
  get isDevelopment(): boolean {
    return this.environment === 'development';
  }

  /**
   * Check if running in production
   */
  get isProduction(): boolean {
    return this.environment === 'production';
  }

  /**
   * Check if this is a debug build
   */
  get isDebugBuild(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  // MARK: - API Configuration

  /**
   * API base URL (for external requests)
   */
  get apiBaseURL(): string {
    return process.env.NEXT_PUBLIC_API_URL || '';
  }

  /**
   * App base URL
   */
  get appBaseURL(): string {
    return process.env.NEXT_PUBLIC_APP_URL || '';
  }

  // MARK: - Clerk Configuration

  /**
   * Clerk publishable key
   */
  get clerkPublishableKey(): string {
    return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
  }

  // MARK: - App Info

  /**
   * Application name
   */
  get appName(): string {
    return 'Forge';
  }

  /**
   * Support email
   */
  get supportEmail(): string {
    return 'support@forge-app.io';
  }

  /**
   * Terms of Service URL
   */
  get termsOfServiceURL(): string {
    return 'https://www.forge-app.io/terms';
  }

  /**
   * Privacy Policy URL
   */
  get privacyPolicyURL(): string {
    return 'https://www.forge-app.io/privacy';
  }

  // MARK: - Timeouts

  /**
   * Default request timeout (ms)
   */
  get defaultTimeout(): number {
    return 30000; // 30 seconds
  }

  /**
   * Upload request timeout (ms)
   */
  get uploadTimeout(): number {
    return 300000; // 5 minutes
  }

  // MARK: - Upload Limits

  /**
   * Maximum image size in bytes (10MB)
   */
  get maxImageSize(): number {
    return 10 * 1024 * 1024;
  }

  /**
   * Maximum video size in bytes (100MB)
   */
  get maxVideoSize(): number {
    return 100 * 1024 * 1024;
  }

  /**
   * Maximum audio size in bytes (50MB)
   */
  get maxAudioSize(): number {
    return 50 * 1024 * 1024;
  }

  // MARK: - Pagination

  /**
   * Default page size for feeds
   */
  get defaultPageSize(): number {
    return 20;
  }

  /**
   * Maximum page size for feeds
   */
  get maxPageSize(): number {
    return 50;
  }

  // MARK: - Cache Settings

  /**
   * Default cache stale time (ms) - 5 minutes
   */
  get cacheStaleTime(): number {
    return 5 * 60 * 1000;
  }

  /**
   * Default cache garbage collection time (ms) - 30 minutes
   */
  get cacheGcTime(): number {
    return 30 * 60 * 1000;
  }
}

// Export singleton instance
export const config = ConfigService.shared;

// Also export class for testing
export { ConfigService };

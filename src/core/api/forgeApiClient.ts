"use client";

/**
 * Forge API Client
 * Centralized API client for all Forge backend calls.
 * Mirrors iOS ForgeAPIClient.swift singleton pattern.
 */

import { ForgeAPIError } from './apiErrors';
import type {
  APIProfileResponse,
} from '../models/apiModels';
import type {
  BibleBooksResponse,
  BibleChaptersResponse,
  BibleChapterContentResponse,
  BiblePassageResponse,
  VerseOfTheDayResponse,
  BibleTranslationsResponse,
} from '../models/bibleModels';

// MARK: - Types

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestConfig {
  method?: HTTPMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

// MARK: - API Client Class

class ForgeAPIClient {
  private static instance: ForgeAPIClient;
  private baseURL: string;

  private constructor() {
    // In browser, use relative URLs. In SSR, could fall back to env var.
    this.baseURL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL || '');
  }

  /**
   * Get the singleton instance
   */
  static get shared(): ForgeAPIClient {
    if (!ForgeAPIClient.instance) {
      ForgeAPIClient.instance = new ForgeAPIClient();
    }
    return ForgeAPIClient.instance;
  }

  /**
   * Make an API request
   */
  private async request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = config;

    const url = `${this.baseURL}${endpoint}`;

    const requestHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    };

    const fetchConfig: RequestInit = {
      method,
      headers: requestHeaders,
      credentials: 'include', // Include cookies for Clerk auth
    };

    if (body && method !== 'GET') {
      fetchConfig.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchConfig);

      if (!response.ok) {
        throw await ForgeAPIError.fromResponse(response);
      }

      // Handle empty responses (204 No Content, etc.)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T;
      }

      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof ForgeAPIError) {
        throw error;
      }
      throw ForgeAPIError.fromNetworkError(
        error instanceof Error ? error : new Error('Unknown error')
      );
    }
  }

  // ============================================
  // MARK: - Profile
  // ============================================

  /**
   * Get current user's profile
   */
  async getProfile(): Promise<APIProfileResponse> {
    return this.request<APIProfileResponse>('/api/profile');
  }

  /**
   * Update user profile
   */
  async updateProfile(data: {
    displayName?: string;
    handle?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<APIProfileResponse> {
    return this.request<APIProfileResponse>('/api/profile', {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Upload avatar image
   */
  async uploadAvatar(formData: FormData): Promise<{ profileImageUrl: string }> {
    // Special handling for FormData - don't set Content-Type (browser will set with boundary)
    const response = await fetch(`${this.baseURL}/api/profile/avatar`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      throw await ForgeAPIError.fromResponse(response);
    }

    return response.json();
  }

  // ============================================
  // MARK: - Bible
  // ============================================

  /**
   * Get list of Bible books
   */
  async getBibleBooks(translation: string = 'ESV'): Promise<BibleBooksResponse> {
    return this.request<BibleBooksResponse>(
      `/api/bible/books?translation=${encodeURIComponent(translation)}`
    );
  }

  /**
   * Get chapters for a Bible book
   */
  async getBibleChapters(
    bookId: string,
    translation: string = 'ESV'
  ): Promise<BibleChaptersResponse> {
    const params = new URLSearchParams({
      bookId,
      translation,
    });
    return this.request<BibleChaptersResponse>(`/api/bible/chapters?${params}`);
  }

  /**
   * Get chapter content
   */
  async getBibleChapter(
    chapterId: string,
    translation: string = 'ESV'
  ): Promise<BibleChapterContentResponse> {
    return this.request<BibleChapterContentResponse>(
      `/api/bible/chapter/${encodeURIComponent(chapterId)}?translation=${encodeURIComponent(translation)}`
    );
  }

  /**
   * Get passage by reference (e.g., "John 3:16")
   */
  async getBiblePassage(
    reference: string,
    translation: string = 'ESV'
  ): Promise<BiblePassageResponse> {
    const params = new URLSearchParams({
      reference,
      translation,
    });
    return this.request<BiblePassageResponse>(`/api/bible/passage?${params}`);
  }

  /**
   * Get verse of the day
   */
  async getVerseOfTheDay(translation: string = 'ESV'): Promise<VerseOfTheDayResponse> {
    return this.request<VerseOfTheDayResponse>(
      `/api/bible/verse-of-the-day?translation=${encodeURIComponent(translation)}`
    );
  }

  /**
   * Get available Bible translations for the current provider
   */
  async getBibleTranslations(): Promise<BibleTranslationsResponse> {
    return this.request<BibleTranslationsResponse>('/api/bible/translations');
  }
}

// Export singleton instance
export const forgeApi = ForgeAPIClient.shared;

// Also export class for testing/mocking
export { ForgeAPIClient };

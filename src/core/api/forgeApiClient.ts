"use client";

/**
 * Forge API Client
 * Centralized API client for all Forge backend calls.
 * Mirrors iOS ForgeAPIClient.swift singleton pattern.
 */

import { ForgeAPIError } from './apiErrors';
import type {
  APIProfileResponse,
  APIThreadsResponse,
  APIPrayerListResponse,
  ThreadDetailResponse,
  CreateThreadRequest,
  CreateThreadResponse,
  UpdateThreadRequest,
  UpdateThreadResponse,
  AddPostRequest,
  AddPostResponse,
  RecordPrayerResponse,
  RemovePrayerResponse,
  PrayerListToggleResponse,
  SuccessResponse,
  AddReactionRequest,
  AddReactionResponse,
} from '../models/apiModels';
import type { CommunityFeedResponse, CommunityFeedParams } from '../models/communityModels';
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
  // MARK: - Threads (Prayer Requests)
  // ============================================

  /**
   * Get threads with filtering options
   */
  async getThreads(params: {
    source?: 'community';
    status?: 'open' | 'answered' | 'archived';
    mine?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<APIThreadsResponse> {
    const searchParams = new URLSearchParams();

    if (params.source) searchParams.set('source', params.source);
    if (params.status) searchParams.set('status', params.status);
    if (params.mine) searchParams.set('mine', 'true');
    if (params.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/api/threads?${queryString}` : '/api/threads';

    return this.request<APIThreadsResponse>(endpoint);
  }

  /**
   * Get detailed thread by ID
   */
  async getThread(threadId: string): Promise<ThreadDetailResponse> {
    return this.request<ThreadDetailResponse>(`/api/threads/${threadId}`);
  }

  /**
   * Create a new prayer request thread
   */
  async createThread(data: CreateThreadRequest): Promise<CreateThreadResponse> {
    return this.request<CreateThreadResponse>('/api/threads', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Update thread (status, title, sharedToCommunity)
   */
  async updateThread(threadId: string, data: UpdateThreadRequest): Promise<UpdateThreadResponse> {
    return this.request<UpdateThreadResponse>(`/api/threads/${threadId}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Delete a thread - author only
   */
  async deleteThread(threadId: string): Promise<SuccessResponse> {
    return this.request<SuccessResponse>(`/api/threads/${threadId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // MARK: - Posts (Thread Entries)
  // ============================================

  /**
   * Add a post to a thread (encouragement, update, testimony, verse)
   */
  async addPost(threadId: string, data: AddPostRequest): Promise<AddPostResponse> {
    return this.request<AddPostResponse>(`/api/threads/${threadId}/posts`, {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Delete a post - author only
   */
  async deletePost(threadId: string, postId: string): Promise<SuccessResponse> {
    return this.request<SuccessResponse>(`/api/threads/${threadId}/posts?postId=${postId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // MARK: - Prayer Actions
  // ============================================

  /**
   * Record a prayer action on a thread
   */
  async recordPrayer(threadId: string, postId?: string): Promise<RecordPrayerResponse> {
    return this.request<RecordPrayerResponse>(`/api/threads/${threadId}/prayers`, {
      method: 'POST',
      body: { postId },
    });
  }

  /**
   * Remove a prayer action from a thread
   */
  async removePrayer(threadId: string, postId: string): Promise<RemovePrayerResponse> {
    return this.request<RemovePrayerResponse>(`/api/threads/${threadId}/prayers`, {
      method: 'DELETE',
      body: { postId },
    });
  }

  /**
   * Add a reaction to a post
   */
  async addReaction(threadId: string, data: AddReactionRequest): Promise<AddReactionResponse> {
    return this.request<AddReactionResponse>(`/api/threads/${threadId}/reactions`, {
      method: 'POST',
      body: data,
    });
  }

  // ============================================
  // MARK: - Prayer List
  // ============================================

  /**
   * Get user's prayer list
   */
  async getPrayerList(): Promise<APIPrayerListResponse> {
    return this.request<APIPrayerListResponse>('/api/prayer-list');
  }

  /**
   * Toggle prayer list status (save/unsave thread)
   */
  async togglePrayerList(threadId: string, entryId?: string): Promise<PrayerListToggleResponse> {
    return this.request<PrayerListToggleResponse>('/api/prayer-list/toggle', {
      method: 'POST',
      body: { threadId, entryId },
    });
  }

  // ============================================
  // MARK: - Community Feed
  // ============================================

  /**
   * Get community feed with filtering
   */
  async getCommunityFeed(params: CommunityFeedParams): Promise<CommunityFeedResponse> {
    const searchParams = new URLSearchParams();

    if (params.filter) searchParams.set('filter', params.filter);
    if (params.source) searchParams.set('source', params.source);
    if (params.status) searchParams.set('status', params.status);
    if (params.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params.offset !== undefined) searchParams.set('offset', params.offset.toString());

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/api/community?${queryString}` : '/api/community';

    return this.request<CommunityFeedResponse>(endpoint);
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

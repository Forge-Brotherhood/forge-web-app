/**
 * Community Feed Models
 * Models specific to the community feed and filtering functionality.
 */

import type { APICommunityThread, APIThreadsResponse } from './apiModels';

// MARK: - Community Feed Response

export interface CommunityFeedResponse {
  threads: APICommunityThread[];
  totalCount: number;
  hasMore: boolean;
}

// Re-export for convenience
export type { APIThreadsResponse as ThreadsResponse };

// MARK: - Community Filter

export type CommunityFilter = 'all' | 'testimonies' | 'requests';

export const CommunityFilters: { value: CommunityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'testimonies', label: 'Testimonies' },
  { value: 'requests', label: 'Requests' },
];

// MARK: - Feed Source

export type FeedSource = 'community' | 'core' | 'circle';

// MARK: - Community Feed Parameters

export interface CommunityFeedParams {
  filter?: CommunityFilter;
  source?: FeedSource;
  groupId?: string;
  status?: 'open' | 'answered' | 'archived';
  limit?: number;
  offset?: number;
}

/** Build query params from feed parameters */
export function buildFeedQueryParams(params: CommunityFeedParams): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (params.filter) searchParams.set('filter', params.filter);
  if (params.source) searchParams.set('source', params.source);
  if (params.groupId) searchParams.set('groupId', params.groupId);
  if (params.status) searchParams.set('status', params.status);
  if (params.limit !== undefined) searchParams.set('limit', params.limit.toString());
  if (params.offset !== undefined) searchParams.set('offset', params.offset.toString());

  return searchParams;
}

// MARK: - Thread Status Options

export interface StatusOption {
  value: 'open' | 'answered' | 'archived';
  label: string;
  description: string;
}

export const ThreadStatusOptions: StatusOption[] = [
  { value: 'open', label: 'Open', description: 'Currently seeking prayer' },
  { value: 'answered', label: 'Answered', description: 'Prayer has been answered' },
  { value: 'archived', label: 'Archived', description: 'No longer active' },
];

// MARK: - Entry Kind Options

export interface EntryKindOption {
  value: 'request' | 'update' | 'testimony' | 'encouragement' | 'verse';
  label: string;
  description: string;
}

export const EntryKindOptions: EntryKindOption[] = [
  { value: 'request', label: 'Prayer Request', description: 'A new prayer request' },
  { value: 'update', label: 'Update', description: 'An update on the prayer' },
  { value: 'testimony', label: 'Testimony', description: 'Share an answered prayer' },
  { value: 'encouragement', label: 'Encouragement', description: 'Words of encouragement' },
  { value: 'verse', label: 'Bible Verse', description: 'Share a relevant verse' },
];

// MARK: - Pagination

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export function calculatePagination(
  totalCount: number,
  limit: number,
  offset: number
): PaginationInfo {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = offset + limit < totalCount;

  return {
    currentPage,
    totalPages,
    totalCount,
    hasMore,
    limit,
    offset,
  };
}

// MARK: - Feed Loading State

export interface FeedLoadingState {
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error?: string;
}

export const initialFeedLoadingState: FeedLoadingState = {
  isLoading: true,
  isRefreshing: false,
  isLoadingMore: false,
  error: undefined,
};

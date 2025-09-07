"use client";

import { useEffect, useState, useCallback } from "react";

export interface GroupFeedThread {
  id: string;
  title: string | null;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: "open" | "answered" | "archived";
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    profileImageUrl: string | null;
  } | null;
  posts: Array<{
    id: string;
    kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
    content: string | null;
    createdAt: string;
    author: {
      id: string;
      displayName: string | null;
      firstName: string | null;
      profileImageUrl: string | null;
    } | null;
    media: Array<{
      id: string;
      type: "image" | "video" | "audio";
      url: string;
      width: number | null;
      height: number | null;
      durationS: number | null;
    }>;
    _count?: {
      prayerActions: number;
    };
  }>;
  _count: {
    posts: number;
    prayers: number;
  };
}

interface GroupMember {
  id: string;
  userId: string;
  status: "active" | "inactive";
  joinedAt: string;
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    profileImageUrl: string | null;
  };
  prayerStreak?: number;
  lastPrayerAt?: string;
}

interface Group {
  id: string;
  name: string | null;
  groupType: "core" | "circle";
  members: GroupMember[];
  _count: {
    threads: number;
    totalPrayers: number;
  };
}

export interface GroupStats {
  totalMembers: number;
  activeToday: number;
  weeklyPrayers: number;
  averageStreak: number;
  groupStreak: number;
  challengeProgress?: {
    name: string;
    current: number;
    target: number;
    endDate: string;
  };
}

interface UseGroupFeedResult {
  group: Group | null;
  threads: GroupFeedThread[];
  stats: GroupStats | null;
  members: GroupMember[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

export function useGroupFeed(initialLimit: number = 20): UseGroupFeedResult {
  const [group, setGroup] = useState<Group | null>(null);
  const [threads, setThreads] = useState<GroupFeedThread[]>([]);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [limit] = useState(initialLimit);

  const fetchGroupData = useCallback(async (reset: boolean = true) => {
    try {
      if (reset) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      // Fetch user's core group (only on reset/first load)
      if (reset) {
        const groupResponse = await fetch("/api/groups?type=core");
        if (!groupResponse.ok) throw new Error("Failed to fetch group");
        const groups = await groupResponse.json();
        const coreGroup = groups[0]; // User's core group
        
        if (!coreGroup) {
          setIsLoading(false);
          return;
        }

        setGroup(coreGroup);
        setMembers(coreGroup.members || []);

        // Calculate group stats
        const totalMembers = coreGroup.members?.length || 0;
        const activeToday = coreGroup.members?.filter((m: GroupMember) => {
          const lastPrayer = m.lastPrayerAt ? new Date(m.lastPrayerAt) : null;
          const today = new Date();
          return lastPrayer && lastPrayer.toDateString() === today.toDateString();
        }).length || 0;

        const avgStreak = totalMembers > 0 
          ? Math.round((coreGroup.members?.reduce((sum: number, m: GroupMember) => sum + (m.prayerStreak || 0), 0) || 0) / totalMembers)
          : 0;

        setStats({
          totalMembers,
          activeToday,
          weeklyPrayers: coreGroup._count?.totalPrayers || 0,
          averageStreak: avgStreak,
          groupStreak: Math.max(...(coreGroup.members?.map((m: GroupMember) => m.prayerStreak || 0) || [0])),
          challengeProgress: {
            name: "Weekly Prayer Goal",
            current: Math.min(coreGroup._count?.totalPrayers || 0, 100),
            target: 100,
            endDate: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days from now
          }
        });
      }

      // Fetch group threads with pagination
      const currentOffset = reset ? 0 : offset;
      const threadsResponse = await fetch(`/api/threads?source=core&limit=${limit}&offset=${currentOffset}`);
      if (!threadsResponse.ok) throw new Error("Failed to fetch threads");
      const threadsData = await threadsResponse.json();
      
      if (reset) {
        setThreads(threadsData.threads || []);
        setOffset((threadsData.threads || []).length);
      } else {
        setThreads(prev => [...prev, ...(threadsData.threads || [])]);
        setOffset(prev => prev + (threadsData.threads || []).length);
      }
      
      setHasMore(threadsData.hasMore || false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch group data";
      setError(errorMessage);
      console.error("Error loading group data:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [limit, offset]);

  const refetch = useCallback(() => {
    setOffset(0);
    fetchGroupData(true);
  }, [fetchGroupData]);

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchGroupData(false);
    }
  }, [fetchGroupData, isLoadingMore, hasMore]);

  useEffect(() => {
    fetchGroupData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  return {
    group,
    threads,
    stats,
    members,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    isLoadingMore,
  };
}
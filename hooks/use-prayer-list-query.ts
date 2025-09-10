import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface PrayerListAuthor {
  id: string;
  displayName: string;
  firstName: string;
  profileImageUrl?: string;
}

export interface PrayerListGroup {
  id: string;
  name: string;
  groupType: string;
}

export interface PrayerListPost {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  author: PrayerListAuthor | null;
  media: any[];
}

export interface PrayerListThread {
  id: string;
  title?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isAnonymous: boolean;
  sharedToCommunity: boolean;
  author: PrayerListAuthor | null;
  group: PrayerListGroup | null;
  posts: PrayerListPost[];
  _count: {
    prayers: number;
    posts: number;
    prayerListItems: number;
  };
}

export interface PrayerListItem {
  id: string;
  userId: string;
  threadId: string;
  postId: string | null;
  createdAt: string;
  thread: PrayerListThread;
  post: {
    id: string;
    kind: string;
    content: string;
  } | null;
}

export interface PrayerListResponse {
  success: boolean;
  items: PrayerListItem[];
  count: number;
}

export const prayerListKeys = {
  all: ["prayerList"] as const,
  list: () => [...prayerListKeys.all, "list"] as const,
  filtered: (filters: any) => [...prayerListKeys.list(), filters] as const,
};

export function usePrayerListQuery() {
  return useQuery<PrayerListResponse>({
    queryKey: prayerListKeys.list(),
    queryFn: async () => {
      const response = await fetch("/api/prayer-list");
      if (!response.ok) {
        throw new Error("Failed to fetch prayer list");
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useRemoveFromPrayerList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId?: string }) => {
      const response = await fetch("/api/prayer-list", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, postId: postId || undefined }),
      });

      if (!response.ok) {
        throw new Error("Failed to remove from prayer list");
      }

      return response.json();
    },
    onMutate: async ({ threadId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: prayerListKeys.list() });

      // Snapshot previous value
      const previousList = queryClient.getQueryData<PrayerListResponse>(
        prayerListKeys.list()
      );

      // Optimistically remove from list
      if (previousList) {
        queryClient.setQueryData<PrayerListResponse>(prayerListKeys.list(), {
          ...previousList,
          items: previousList.items.filter(item => item.threadId !== threadId),
          count: previousList.count - 1,
        });
      }

      return { previousList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData(prayerListKeys.list(), context.previousList);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: prayerListKeys.list() });
    },
  });
}
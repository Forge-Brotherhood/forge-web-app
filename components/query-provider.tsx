"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable refetch on window focus to reduce duplicate calls
            refetchOnWindowFocus: false,
            // Retry failed requests 2 times (reduced for faster failure feedback)
            retry: 2,
            // Consider data stale after 5 minutes (increased for better deduplication)
            staleTime: 5 * 60 * 1000,
            // Keep data in cache for 30 minutes (crucial for instant back navigation)
            gcTime: 30 * 60 * 1000,
            // Only refetch on mount if data is stale (enables instant loading)
            refetchOnMount: true,
            // Prefer showing stale data while refetching
            notifyOnChangeProps: ["data", "error"],
            // Use placeholderData instead of deprecated keepPreviousData
            placeholderData: (previousData: any) => previousData,
          },
          mutations: {
            // Retry mutations once on failure
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
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
            // Background refetch when window refocuses
            refetchOnWindowFocus: true,
            // Retry failed requests 3 times with exponential backoff
            retry: 3,
            // Consider data stale after 30 seconds (shorter for more responsive updates)
            staleTime: 30 * 1000,
            // Keep data in cache for 10 minutes
            gcTime: 10 * 60 * 1000,
            // Always refetch on mount to ensure fresh data
            refetchOnMount: "always",
            // Prefer showing stale data while refetching
            notifyOnChangeProps: ["data", "error"],
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
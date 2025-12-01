"use client";

/**
 * Providers Component
 * Unified wrapper for all client-side providers.
 * Follows Next.js best practice of consolidating providers into a single "use client" boundary.
 */

import * as React from "react";
import { useState } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { config } from "@core/services/configService";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // Create QueryClient with optimized settings
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable refetch on window focus to reduce duplicate calls
            refetchOnWindowFocus: false,
            // Retry failed requests 2 times
            retry: 2,
            // Consider data stale after 5 minutes
            staleTime: config.cacheStaleTime,
            // Keep data in cache for 30 minutes
            gcTime: config.cacheGcTime,
            // Only refetch on mount if data is stale
            refetchOnMount: true,
            // Prefer showing stale data while refetching
            notifyOnChangeProps: ["data", "error"],
            // Use placeholderData for instant navigation
            placeholderData: (previousData: unknown) => previousData,
          },
          mutations: {
            // Retry mutations once on failure
            retry: 1,
          },
        },
      })
  );

  return (
    <ClerkProvider>
      <QueryClientProvider client={queryClient}>
        <NextThemesProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </NextThemesProvider>
        {config.isDevelopment && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ClerkProvider>
  );
}

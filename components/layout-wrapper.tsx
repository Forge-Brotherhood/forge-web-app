"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

  return (
    <main className={cn(
      "min-h-screen pb-24 md:pb-0",
      !isAuthPage && "md:ml-20"
    )}>
      {children}
    </main>
  );
}
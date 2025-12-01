"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { HandHelping, Users, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const navItems: NavItem[] = [
  {
    name: "Pray",
    href: "/pray",
    icon: HandHelping,
    label: "Pray",
  },
  {
    name: "Groups",
    href: "/groups",
    icon: Users,
    label: "Groups",
  },
  {
    name: "Activity",
    href: "/activity",
    icon: Bell,
    label: "Activity",
  },
  {
    name: "Me",
    href: "/me",
    icon: User,
    label: "Me",
  },
];

export const Sidebar = () => {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check mobile on mount
    setIsMobile(window.innerWidth < 768);
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener("resize", checkMobile);
    
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Determine which logo to use based on theme
  const logoSrc = mounted && (resolvedTheme === 'light') 
    ? "/forge-light-logo.svg" 
    : "/forge-logo.svg";





  // Desktop Sidebar
  const DesktopSidebar = () => (
    <aside className="fixed left-0 top-0 z-40 h-screen w-20 border-r border-border bg-card shadow-sm dark:shadow-none hidden md:flex">
      <nav className="flex flex-col items-center w-full h-full relative">
        {/* Forge Logo at the top */}
        <div className="absolute top-0 flex items-center justify-center w-full py-6">
          <Link href="/" className="flex items-center justify-center">
            {mounted && (
              <Image
                src={logoSrc}
                alt="Forge"
                width={28}
                height={28}
                className="w-7 h-7"
              />
            )}
          </Link>
        </div>
        
        {/* Navigation items centered in viewport */}
        <div className="flex flex-col items-center justify-center w-full h-full space-y-8">
          {navItems.map((item) => {
          const isActive = pathname === item.href ||
                          (item.href === "/pray" && pathname === "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex items-center justify-center w-16 h-16 rounded-xl transition-all duration-200",
                isActive ? "bg-accent" : "hover:bg-accent/10"
              )}
              aria-label={item.label}
            >
              <item.icon
                className={cn(
                  "sidebar-icon",
                  isActive
                    ? "text-accent-foreground"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              {/* Tooltip */}
              <span className="absolute left-full ml-3 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                {item.label}
              </span>
            </Link>
          );
        })}
        </div>
      </nav>
    </aside>
  );

  // Mobile Bottom Navigation
  const MobileNav = () => (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border shadow-[0_-2px_4px_rgba(0,0,0,0.05)] dark:shadow-none px-3 pt-3 md:hidden" style={{
      paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
    }}>
      <div className="grid grid-cols-4 gap-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
                          (item.href === "/pray" && pathname === "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center justify-center p-3 rounded-xl transition-all duration-200 h-12",
                isActive ? "bg-accent" : "hover:bg-accent/10"
              )}
              aria-label={item.label}
            >
              <item.icon
                className={cn(
                  "w-6 h-6",
                  isActive
                    ? "text-accent-foreground"
                    : "text-muted-foreground"
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );

  // Hide sidebar on auth pages and public invite pages
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
  const isJoinPage = pathname.startsWith('/join');

  if (isAuthPage || isJoinPage) {
    return null;
  }

  // Always render to maintain consistent hook ordering
  return (
    <>
      {isMobile !== null && (
        <>
          <DesktopSidebar />
          {isMobile && <MobileNav />}
        </>
      )}
    </>
  );
};

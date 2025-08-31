"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Home, Users, Heart, MoreHorizontal } from "lucide-react";
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
    name: "Community",
    href: "/community",
    icon: Home,
    label: "Community",
  },
  {
    name: "My Core Group",
    href: "/group",
    icon: Users,
    label: "Core Group",
  },
  {
    name: "Prayers",
    href: "/prayers",
    icon: Heart,
    label: "My Prayers",
  },
];

export const Sidebar = () => {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const { theme, resolvedTheme } = useTheme();
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
    <aside className="fixed left-0 top-0 z-40 h-screen w-20 border-r border-border bg-card/50 backdrop-blur-sm hidden md:flex">
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
                          (item.href === "/community" && pathname === "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex items-center justify-center w-16 h-16 rounded-xl transition-all duration-200",
                "hover:bg-secondary/50",
                isActive && "bg-accent/10"
              )}
              aria-label={item.label}
            >
              <item.icon
                className={cn(
                  "sidebar-icon",
                  isActive 
                    ? "sidebar-icon-active" 
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
        
        {/* More/Settings button at bottom */}
        <div className="absolute bottom-0 flex items-center justify-center w-full py-6">
          <Link
            href="/profile"
            className={cn(
              "group relative flex items-center justify-center w-16 h-16 rounded-xl transition-all duration-200",
              "hover:bg-secondary/50",
              pathname === "/profile" && "bg-accent/10"
            )}
            aria-label="Profile & Settings"
          >
            <MoreHorizontal
              className={cn(
                "sidebar-icon",
                pathname === "/profile"
                  ? "sidebar-icon-active" 
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            {/* Tooltip */}
            <span className="absolute left-full ml-3 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
              Profile & Settings
            </span>
          </Link>
        </div>
      </nav>
    </aside>
  );

      // Mobile Bottom Navigation
  const MobileNav = () => (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border px-3 pt-3 md:hidden" style={{
      paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
    }}>
      <div className="grid grid-cols-4 gap-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || 
                          (item.href === "/community" && pathname === "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center justify-center p-3 rounded-lg transition-all duration-200 h-12",
                "hover:bg-secondary/50",
                isActive && "bg-accent/10"
              )}
              aria-label={item.label}
            >
              <item.icon
                className={cn(
                  "w-6 h-6",
                  isActive 
                    ? "text-accent drop-shadow-[0_0_10px_rgba(217,119,6,0.8)] dark:drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]" 
                    : "text-muted-foreground"
                )}
              />
            </Link>
          );
        })}
        
        {/* More/Settings button */}
        <Link
          href="/profile"
          className={cn(
            "flex items-center justify-center p-3 rounded-lg transition-all duration-200 h-12",
            "hover:bg-secondary/50",
            pathname === "/profile" && "bg-accent/10"
          )}
          aria-label="Profile & Settings"
        >
          <MoreHorizontal
            className={cn(
              "w-6 h-6",
              pathname === "/profile"
                ? "text-accent drop-shadow-[0_0_10px_rgba(217,119,6,0.8)] dark:drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]" 
                : "text-muted-foreground"
            )}
          />
        </Link>
      </div>
    </nav>
  );

  // Don't render until we know if it's mobile or not
  if (isMobile === null) {
    return null;
  }

  return (
    <>
      <DesktopSidebar />
      {isMobile && <MobileNav />}
    </>
  );
};

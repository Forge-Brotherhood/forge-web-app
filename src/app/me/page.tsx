"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Moon,
  Sun,
  Monitor,
  LogOut,
  Camera,
  Loader2,
  ChevronRight,
  Pencil,
  Flame,
  Heart,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useClerk, useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function MePage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const [mounted, setMounted] = useState(false);
  const [userStats, setUserStats] = useState({
    prayerCount: 0,
    encouragementCount: 0,
  });
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Prevent hydration mismatch and initialize form data
  useEffect(() => {
    setMounted(true);
    if (clerkUser) {
      setDisplayName(clerkUser.fullName || "");
    }
  }, [clerkUser]);

  // Fetch user statistics and avatar from API
  useEffect(() => {
    const fetchUserData = async () => {
      if (!clerkUser) return;

      try {
        // Fetch user stats
        const statsResponse = await fetch(`/api/users/${clerkUser.id}/stats`);
        if (statsResponse.ok) {
          const stats = await statsResponse.json();
          setUserStats(stats);
        }

        // Fetch user profile with avatar from database
        const profileResponse = await fetch(`/api/profile`);
        if (profileResponse.ok) {
          const profile = await profileResponse.json();
          if (profile.profileImageUrl) {
            setUserAvatar(profile.profileImageUrl);
          }
          if (profile.displayName) {
            setDisplayName(profile.displayName);
          }
        }
      } catch (error) {
        console.error("Failed to fetch user data:", error);
      }
    };

    fetchUserData();
  }, [clerkUser]);

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
  };

  const handleSignOut = () => {
    signOut();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 5MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfileUpdate = async () => {
    if (!clerkUser) return;

    setIsUpdating(true);

    try {
      let avatarUrl = null;

      // Upload avatar to S3 if a new image was selected
      if (selectedImage) {
        const avatarFormData = new FormData();
        avatarFormData.append("avatar", selectedImage);

        const avatarResponse = await fetch("/api/profile/avatar", {
          method: "POST",
          body: avatarFormData,
        });

        if (!avatarResponse.ok) {
          const error = await avatarResponse.json();
          throw new Error(error.error || "Failed to upload avatar");
        }

        const avatarResult = await avatarResponse.json();
        avatarUrl = avatarResult.avatarUrl;
        setUserAvatar(avatarUrl);
      }

      // Update user profile information
      const updateData = {
        displayName: displayName.trim() || undefined,
        ...(avatarUrl && { profileImageUrl: avatarUrl }),
      };

      const response = await fetch(`/api/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      const updatedProfile = await response.json();

      if (updatedProfile.profileImageUrl) {
        setUserAvatar(updatedProfile.profileImageUrl);
      }

      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });

      setIsEditDialogOpen(false);
      setSelectedImage(null);
      setPreviewUrl(null);
    } catch (error) {
      console.error("Failed to update profile:", error);
      toast({
        title: "Update failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditDialogOpen(false);
    setDisplayName(clerkUser?.fullName || "");
    setSelectedImage(null);
    setPreviewUrl(null);
  };

  // Get the current theme for display
  const currentTheme = mounted ? theme : "dark";

  // Get member since date from Clerk user
  const getMemberSince = () => {
    if (!clerkUser?.createdAt) return "2024";
    return new Date(clerkUser.createdAt).getFullYear().toString();
  };

  const getInitials = () => {
    const name = clerkUser?.fullName || clerkUser?.username || "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Show loading if user data isn't loaded yet
  if (!clerkUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <h1 className="text-xl font-semibold text-foreground mb-6">Me</h1>

        {/* Profile Hero */}
        <div className="flex flex-col items-center text-center mb-8">
          {/* Avatar */}
          <Avatar className="w-24 h-24 mb-4">
            <AvatarImage
              src={userAvatar || undefined}
              alt={clerkUser.fullName || "User"}
            />
            <AvatarFallback className="text-2xl font-medium">
              {getInitials()}
            </AvatarFallback>
          </Avatar>

          {/* Name */}
          <h2 className="text-2xl font-bold text-foreground mb-1">
            {displayName || clerkUser.fullName || clerkUser.username || "User"}
          </h2>

          {/* Email */}
          <p className="text-muted-foreground mb-4">
            {clerkUser.primaryEmailAddress?.emailAddress}
          </p>

          {/* Stats */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Flame className="w-4 h-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-lg font-semibold text-foreground">
                  {userStats.prayerCount}
                </p>
                <p className="text-xs text-muted-foreground">Prayers</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center">
                <Heart className="w-4 h-4 text-pink-500" />
              </div>
              <div className="text-left">
                <p className="text-lg font-semibold text-foreground">
                  {userStats.encouragementCount}
                </p>
                <p className="text-xs text-muted-foreground">Encouraged</p>
              </div>
            </div>
          </div>

          {/* Edit Profile Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditDialogOpen(true)}
            className="mt-6"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Edit Profile
          </Button>
        </div>

        {/* Settings Sections */}
        <div className="space-y-6">
          {/* Appearance */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide px-1">
              Appearance
            </h3>
            <div className="rounded-xl bg-card p-1">
              <div className="grid grid-cols-3 gap-1">
                <button
                  onClick={() => handleThemeChange("light")}
                  disabled={!mounted}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-lg transition-colors",
                    currentTheme === "light"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/10 text-muted-foreground"
                  )}
                >
                  <Sun className="w-4 h-4" />
                  <span className="text-sm font-medium">Light</span>
                </button>
                <button
                  onClick={() => handleThemeChange("dark")}
                  disabled={!mounted}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-lg transition-colors",
                    currentTheme === "dark"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/10 text-muted-foreground"
                  )}
                >
                  <Moon className="w-4 h-4" />
                  <span className="text-sm font-medium">Dark</span>
                </button>
                <button
                  onClick={() => handleThemeChange("system")}
                  disabled={!mounted}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-lg transition-colors",
                    currentTheme === "system"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/10 text-muted-foreground"
                  )}
                >
                  <Monitor className="w-4 h-4" />
                  <span className="text-sm font-medium">Auto</span>
                </button>
              </div>
            </div>
          </div>

          {/* Account */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide px-1">
              Account
            </h3>
            <div className="rounded-xl bg-card overflow-hidden">
              <SettingsRow
                label="Member since"
                value={getMemberSince()}
              />
            </div>
          </div>

          {/* Sign Out */}
          <div className="pt-4">
            <button
              onClick={handleSignOut}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3 rounded-xl",
                "bg-destructive/10 text-destructive",
                "hover:bg-destructive/20 transition-colors"
              )}
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your profile photo and display name
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Avatar Upload */}
            <div className="flex justify-center">
              <div className="relative">
                <Avatar className="w-24 h-24">
                  <AvatarImage
                    src={previewUrl || userAvatar || undefined}
                    alt="Profile preview"
                  />
                  <AvatarFallback className="text-2xl">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "absolute bottom-0 right-0 w-8 h-8 rounded-full",
                    "bg-primary text-primary-foreground",
                    "flex items-center justify-center",
                    "hover:bg-primary/90 transition-colors"
                  )}
                >
                  <Camera className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
              </div>
            </div>

            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your display name"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelEdit}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button onClick={handleProfileUpdate} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Settings Row Component
function SettingsRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-4 py-3",
        onClick && "hover:bg-accent/5 transition-colors"
      )}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {value && <span className="text-muted-foreground">{value}</span>}
        {onClick && (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
    </Component>
  );
}

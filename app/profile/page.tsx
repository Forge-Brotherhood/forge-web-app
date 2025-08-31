"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Moon, Sun, Monitor, Settings, User, Bell, LogOut, Edit, Camera, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useClerk, useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function ProfilePage() {
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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Prevent hydration mismatch and initialize form data
  useEffect(() => {
    setMounted(true);
    if (clerkUser) {
      setFirstName(clerkUser.firstName || "");
      setLastName(clerkUser.lastName || "");
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
          if (profile.avatarUrl) {
            setUserAvatar(profile.avatarUrl);
          }
        }
      } catch (error) {
        console.error('Failed to fetch user data:', error);
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
      }
      
      // Update user profile information
      const updateData = {
        firstName,
        lastName,
        ...(avatarUrl && { profileImageUrl: avatarUrl })
      };
      
      const response = await fetch(`/api/users/${clerkUser.id}/update`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });
      
      if (!response.ok) {
        throw new Error("Failed to update profile");
      }
      
      await response.json();
      
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });
      
      setIsEditDialogOpen(false);
      setSelectedImage(null);
      setPreviewUrl(null);
      
      // Reload user data to reflect changes
      window.location.reload();
    } catch (error) {
      console.error("Failed to update profile:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditDialogOpen(false);
    setFirstName(clerkUser?.firstName || "");
    setLastName(clerkUser?.lastName || "");
    setSelectedImage(null);
    setPreviewUrl(null);
  };

  // Get the current theme for display, defaulting to dark during SSR
  const currentTheme = mounted ? theme : "dark";

  // Get member since date from Clerk user
  const getMemberSince = () => {
    if (!clerkUser?.createdAt) return "2024";
    return new Date(clerkUser.createdAt).getFullYear().toString();
  };

  // Show loading if user data isn't loaded yet
  if (!clerkUser) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2">Profile & Settings</h1>
          <p className="text-muted-foreground text-lg">Manage your account and preferences</p>
        </div>

        {/* Profile Card */}
        <Card className="mb-6 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Profile Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={userAvatar || clerkUser.imageUrl} alt={clerkUser.fullName || clerkUser.username || "User"} />
                  <AvatarFallback className="bg-secondary text-secondary-foreground text-lg">
                    {(clerkUser.fullName || clerkUser.username || "U").split(' ').map(n => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {clerkUser.fullName || clerkUser.username || "User"}
                  </h3>
                  <p className="text-muted-foreground">
                    {clerkUser.primaryEmailAddress?.emailAddress || "No email"}
                  </p>
                  <p className="text-sm text-muted-foreground">Member since {getMemberSince()}</p>
                </div>
              </div>
              
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Edit className="w-4 h-4" />
                    Edit Profile
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Edit Profile</DialogTitle>
                    <DialogDescription>
                      Update your profile information and picture
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="grid gap-4 py-4">
                    <div className="flex justify-center">
                      <div className="relative">
                        <Avatar className="w-24 h-24">
                          <AvatarImage 
                            src={previewUrl || userAvatar || clerkUser.imageUrl} 
                            alt="Profile preview" 
                          />
                          <AvatarFallback className="bg-secondary text-secondary-foreground text-2xl">
                            {(firstName || clerkUser.firstName || "U").charAt(0).toUpperCase()}
                            {(lastName || clerkUser.lastName || "").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute bottom-0 right-0 rounded-full w-8 h-8"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Camera className="w-4 h-4" />
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageSelect}
                        />
                      </div>
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Enter your first name"
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Enter your last name"
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
                    <Button
                      onClick={handleProfileUpdate}
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            
            <div className="flex space-x-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{userStats.prayerCount}</p>
                <p className="text-xs text-muted-foreground">Prayers</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{userStats.encouragementCount}</p>
                <p className="text-xs text-muted-foreground">Encouragements</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card className="mb-6 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Choose your preferred theme</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant={currentTheme === "light" ? "default" : "outline"}
                  size="default"
                  onClick={() => handleThemeChange("light")}
                  disabled={!mounted}
                  className={cn(
                    "h-10 text-xs sm:text-sm font-medium transition-all duration-200 px-2 sm:px-3",
                    currentTheme === "light" 
                      ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60" 
                      : "hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground",
                    !mounted && "opacity-50"
                  )}
                >
                  <Sun className="w-4 h-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Light</span>
                  <span className="sm:hidden">Light</span>
                </Button>
                <Button
                  variant={currentTheme === "dark" ? "default" : "outline"}
                  size="default"
                  onClick={() => handleThemeChange("dark")}
                  disabled={!mounted}
                  className={cn(
                    "h-10 text-xs sm:text-sm font-medium transition-all duration-200 px-2 sm:px-3",
                    currentTheme === "dark" 
                      ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60" 
                      : "hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground",
                    !mounted && "opacity-50"
                  )}
                >
                  <Moon className="w-4 h-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Dark</span>
                  <span className="sm:hidden">Dark</span>
                </Button>
                <Button
                  variant={currentTheme === "system" ? "default" : "outline"}
                  size="default"
                  onClick={() => handleThemeChange("system")}
                  disabled={!mounted}
                  className={cn(
                    "h-10 text-xs sm:text-sm font-medium transition-all duration-200 px-2 sm:px-3",
                    currentTheme === "system" 
                      ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60" 
                      : "hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground",
                    !mounted && "opacity-50"
                  )}
                >
                  <Monitor className="w-4 h-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">System</span>
                  <span className="sm:hidden">Auto</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Other Settings */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications & Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm sm:text-base">Push Notifications</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Get notified about prayers</p>
              </div>
              <Button variant="outline" size="default" className="h-9 text-xs sm:text-sm font-medium px-3 flex-shrink-0">
                Configure
              </Button>
            </div>
            
            <Separator />
            
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm sm:text-base">Privacy Settings</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Control your visibility</p>
              </div>
              <Button variant="outline" size="default" className="h-9 text-xs sm:text-sm font-medium px-3 flex-shrink-0">
                Manage
              </Button>
            </div>
            
            <Separator />
            
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm sm:text-base">Account Security</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Password & security</p>
              </div>
              <Button variant="outline" size="default" className="h-9 text-xs sm:text-sm font-medium px-3 flex-shrink-0">
                Secure
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sign Out Section */}
        <Card className="mt-6 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <LogOut className="w-5 h-5" />
              Sign Out
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm sm:text-base">Sign out of your account</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">You&apos;ll need to sign in again to access your account</p>
              </div>
              <Button 
                variant="destructive" 
                size="default" 
                onClick={handleSignOut}
                className="h-9 text-xs sm:text-sm font-medium px-3 flex-shrink-0"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}



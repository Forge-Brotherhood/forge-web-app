"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Calendar, Edit2, Mail, User, Hash, Shield } from "lucide-react";
import { format } from "date-fns";
import { ProfileEditDialog } from "./profile-edit-dialog";
import { AvatarUploadDialog } from "./avatar-upload-dialog";
import { Role } from "@prisma/client";

interface ProfileContentProps {
  user: {
    id: string;
    displayName: string;
    handle: string;
    email: string;
    avatarUrl: string;
    createdAt: Date;
    role: Role;
  };
  stats: {
    prayerRequests: number;
    prayersGiven: number;
    encouragements: number;
  };
}

export function ProfileContent({ user, stats }: ProfileContentProps) {
  const router = useRouter();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);

  const handleProfileUpdate = () => {
    router.refresh();
    setIsEditDialogOpen(false);
  };

  const handleAvatarUpdate = () => {
    router.refresh();
    setIsAvatarDialogOpen(false);
  };

  const getInitials = () => {
    if (user.displayName) {
      return user.displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email ? user.email[0].toUpperCase() : "U";
  };

  const getRoleBadgeVariant = (role: Role) => {
    switch (role) {
      case "admin":
        return "destructive";
      case "moderator":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <Avatar className="h-20 w-20 cursor-pointer transition-opacity group-hover:opacity-80">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                  <AvatarFallback>{getInitials()}</AvatarFallback>
                </Avatar>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-full"
                  onClick={() => setIsAvatarDialogOpen(true)}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              </div>
              <div>
                <CardTitle className="text-2xl">{user.displayName || "Unnamed User"}</CardTitle>
                {user.handle && (
                  <CardDescription className="flex items-center gap-1 mt-1">
                    <Hash className="h-3 w-3" />
                    {user.handle}
                  </CardDescription>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditDialogOpen(true)}
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{user.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Joined {format(user.createdAt, "MMMM yyyy")}</span>
            </div>
            {user.role !== "user" && (
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <Badge variant={getRoleBadgeVariant(user.role)}>
                  {user.role}
                </Badge>
              </div>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-4">Activity</h3>
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{stats.prayerRequests}</div>
                  <div className="text-sm text-muted-foreground">Prayer Requests</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{stats.prayersGiven}</div>
                  <div className="text-sm text-muted-foreground">Prayers Given</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{stats.encouragements}</div>
                  <div className="text-sm text-muted-foreground">Encouragements</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      <ProfileEditDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        user={user}
        onSuccess={handleProfileUpdate}
      />

      <AvatarUploadDialog
        open={isAvatarDialogOpen}
        onOpenChange={setIsAvatarDialogOpen}
        currentAvatarUrl={user.avatarUrl}
        onSuccess={handleAvatarUpdate}
      />
    </>
  );
}



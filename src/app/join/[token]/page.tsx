"use client";

import { use, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, SignInButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import Image from "next/image";
import { Users, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { forgeApi } from "@/core/api/forgeApiClient";
import { profileKeys } from "@/core/hooks/useProfile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { InviteDetailsResponse } from "@/core/models/apiModels";

const PENDING_INVITE_KEY = "forge_pending_invite_token";

interface JoinPageProps {
  params: Promise<{ token: string }>;
}

export default function JoinPage({ params }: JoinPageProps) {
  const { token } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { resolvedTheme } = useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteDetails, setInviteDetails] = useState<InviteDetailsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const hasAutoJoined = useRef(false);

  // Theme-aware logo
  const logoSrc = mounted && (resolvedTheme === 'light')
    ? "/forge-light-logo.svg"
    : "/forge-logo.svg";

  // Derived state
  const isValid = inviteDetails?.valid ?? false;
  const isExpired = inviteDetails?.expired ?? false;
  const isAlreadyMember = inviteDetails?.alreadyMember ?? false;
  const canJoin = isValid && !isExpired && !isAlreadyMember && !isJoining;

  const groupName = inviteDetails?.group?.name ?? "a group";
  const groupDescription = inviteDetails?.group?.description;
  const memberCount = inviteDetails?.group?.memberCount ?? 0;
  const inviterName = inviteDetails?.inviter?.displayName ?? "Someone";
  const inviterImageUrl = inviteDetails?.inviter?.profileImageUrl;

  // Set mounted for theme-aware logo
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch invite details - works for both authenticated and unauthenticated users
  useEffect(() => {
    async function loadInviteDetails() {
      if (!isAuthLoaded) {
        return; // Wait for auth to load
      }

      setIsLoading(true);
      setError(null);

      try {
        const details = await forgeApi.getInviteDetails(token);
        setInviteDetails(details);

        if (!details.valid) {
          setError(details.error ?? "This invite link is invalid");
        } else if (details.expired) {
          setError("This invite link has expired");
        }
      } catch (err) {
        setError("Failed to load invite details");
      }

      setIsLoading(false);
    }

    loadInviteDetails();
  }, [token, isAuthLoaded, isSignedIn]);

  // Auto-join after sign-in if user clicked "Join" before authenticating
  useEffect(() => {
    async function autoJoinAfterSignIn() {
      if (!isSignedIn || !isAuthLoaded || hasAutoJoined.current) return;

      const pendingToken = localStorage.getItem(PENDING_INVITE_KEY);
      if (pendingToken === token && inviteDetails?.valid && !inviteDetails?.alreadyMember) {
        hasAutoJoined.current = true;
        localStorage.removeItem(PENDING_INVITE_KEY);

        // Auto-join
        setIsJoining(true);
        try {
          const response = await forgeApi.acceptInvite(token);
          queryClient.invalidateQueries({ queryKey: profileKeys.all });
          toast({
            title: "Joined group",
            description: `You've joined ${inviteDetails?.group?.name ?? "the group"}!`,
          });
          router.push(`/groups/${response.group.id}`);
        } catch (err) {
          setError("Failed to join group. Please try again.");
          setIsJoining(false);
        }
      }
    }

    if (inviteDetails && !isLoading) {
      autoJoinAfterSignIn();
    }
  }, [isSignedIn, isAuthLoaded, inviteDetails, isLoading, token, queryClient, toast, router]);

  const handleJoin = async () => {
    if (!canJoin) return;

    setIsJoining(true);
    setError(null);

    try {
      const response = await forgeApi.acceptInvite(token);

      // Invalidate profile to refresh groups list
      queryClient.invalidateQueries({ queryKey: profileKeys.all });

      toast({
        title: "Joined group",
        description: `You've joined ${groupName}!`,
      });

      // Navigate to the group
      router.push(`/groups/${response.group.id}`);
    } catch (err) {
      setError("Failed to join group. Please try again.");
      setIsJoining(false);
    }
  };

  const handleJoinWithSignIn = () => {
    // Store token in localStorage so we can auto-join after sign-in
    localStorage.setItem(PENDING_INVITE_KEY, token);
  };

  const handleDismiss = () => {
    localStorage.removeItem(PENDING_INVITE_KEY);
    window.location.href = "https://www.forge-app.io";
  };

  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  // Auth loading state
  if (!isAuthLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Loading invite details state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading invite...</p>
        </div>
      </div>
    );
  }

  // Error state (invalid or expired) - show for both auth states
  if (!isValid || isExpired) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="flex flex-col items-center">
            {/* Header */}
            <h1 className="text-xl font-semibold text-foreground mb-8">
              Join Group
            </h1>

            {/* Error Card */}
            <div className="w-full p-8 rounded-2xl bg-card shadow-sm flex flex-col items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-orange-500" />
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">
                  Unable to Join
                </h2>
                <p className="text-muted-foreground">
                  {error ?? "This invite link is no longer valid"}
                </p>
              </div>
            </div>

            {/* Action */}
            <div className="w-full mt-8">
              <Button onClick={handleDismiss} className="w-full" size="lg">
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Already member state (only for authenticated users)
  if (isAlreadyMember && isSignedIn) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="flex flex-col items-center">
            {/* Header */}
            <h1 className="text-xl font-semibold text-foreground mb-8">
              Join Group
            </h1>

            {/* Already Member Card */}
            <div className="w-full p-8 rounded-2xl bg-card shadow-sm flex flex-col items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-foreground">
                  Already a Member
                </h2>
                <p className="text-muted-foreground">
                  You&apos;re already a member of {groupName}.
                </p>
              </div>
            </div>

            {/* Action */}
            <div className="w-full mt-8">
              <Button
                onClick={() => router.push(`/groups/${inviteDetails?.group?.id}`)}
                className="w-full"
                size="lg"
              >
                Go to Group
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not signed in state - show minimal invite details with branding
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-4 py-12">
          <div className="flex flex-col items-center">
            {/* Branding Section */}
            <div className="flex flex-col items-center mb-10">
              {mounted && (
                <Image
                  src={logoSrc}
                  alt="Forge"
                  width={48}
                  height={48}
                  className="w-12 h-12 mb-4"
                />
              )}
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Welcome to Forge
              </h1>
              <p className="text-center text-muted-foreground">
                Connect with your community to share and support each other
              </p>
            </div>

            {/* Divider */}
            <div className="w-16 h-px bg-border mb-10" />

            {/* Inviter Info */}
            <div className="flex flex-col items-center gap-4 mb-8">
              <Avatar className="w-20 h-20">
                <AvatarFallback className="text-lg">
                  {getInitials(inviterName)}
                </AvatarFallback>
              </Avatar>

              <p className="text-center">
                <span className="font-semibold text-foreground">{inviterName}</span>
                <span className="text-muted-foreground"> invited you to join</span>
              </p>
            </div>

            {/* Group Info Card - Minimal (no description, no member count) */}
            <div className="w-full p-8 rounded-2xl bg-card shadow-sm flex flex-col items-center gap-6">
              {/* Group Icon */}
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-8 h-8 text-primary" />
              </div>

              {/* Group Name Only */}
              <div className="text-center">
                <h2 className="text-xl font-bold text-foreground">
                  {groupName}
                </h2>
              </div>
            </div>

            {/* Actions */}
            <div className="w-full mt-8 space-y-4">
              <SignInButton mode="modal" forceRedirectUrl={`/join/${token}`}>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleJoinWithSignIn}
                >
                  Join Group
                </Button>
              </SignInButton>

              <Button
                variant="ghost"
                onClick={handleDismiss}
                className="w-full text-muted-foreground"
              >
                Not Now
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main invite content - Authenticated user with full details
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="flex flex-col items-center">
          {/* Header */}
          <h1 className="text-xl font-semibold text-foreground mb-8">
            Join Group
          </h1>

          {/* Inviter Info */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <Avatar className="w-20 h-20">
              {inviterImageUrl && (
                <AvatarImage src={inviterImageUrl} alt={inviterName} />
              )}
              <AvatarFallback className="text-lg">
                {getInitials(inviterName)}
              </AvatarFallback>
            </Avatar>

            <p className="text-center">
              <span className="font-semibold text-foreground">{inviterName}</span>
              <span className="text-muted-foreground"> invited you to join</span>
            </p>
          </div>

          {/* Group Info Card - Full details */}
          <div className="w-full p-8 rounded-2xl bg-card shadow-sm flex flex-col items-center gap-6">
            {/* Group Icon */}
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-8 h-8 text-primary" />
            </div>

            {/* Group Details */}
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-foreground">
                {groupName}
              </h2>
              {groupDescription && (
                <p className="text-muted-foreground">
                  {groupDescription}
                </p>
              )}
            </div>

            {/* Member Count Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <p className="text-sm text-destructive mt-4 text-center">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="w-full mt-8 space-y-4">
            <Button
              onClick={handleJoin}
              disabled={!canJoin}
              className="w-full"
              size="lg"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                "Join Group"
              )}
            </Button>

            <Button
              variant="ghost"
              onClick={handleDismiss}
              className="w-full text-muted-foreground"
            >
              Not Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

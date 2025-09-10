"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Eye, EyeOff } from "lucide-react";
import { useUser, SignedIn } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile-query";
import { useRouter } from "next/navigation";

export function CreatePrayer() {
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [title, setTitle] = useState("");
  const [prayerText, setPrayerText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useUser();
  const { profile } = useProfile();
  const router = useRouter();

  const getInitials = () => {
    // Use profile displayName first, then fall back to Clerk data
    if (profile?.displayName) {
      return profile.displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.firstName) {
      return user.firstName.charAt(0).toUpperCase();
    }
    return <User className="h-4 w-4" />;
  };

  const handleSubmit = async () => {
    if (!title.trim() || !prayerText.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          body: prayerText.trim(),
          isAnonymous,
          tags: [],
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create prayer request");
      }

      const thread = await response.json();
      
      // Clear the form
      setTitle("");
      setPrayerText("");
      setIsAnonymous(false);
      
      // Navigate to the thread detail page
      router.push(`/threads/${thread.id}`);
    } catch (error) {
      console.error("Error creating prayer request:", error);
      // TODO: Show error toast
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SignedIn>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile?.avatarUrl || profile?.profileImageUrl || undefined} alt="You" />
              <AvatarFallback>
                {isAnonymous ? "?" : getInitials()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">
                {isAnonymous ? "Post anonymously" : "Share a prayer request"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAnonymous(!isAnonymous)}
            className="text-muted-foreground hover:text-foreground h-8 w-8"
          >
            {isAnonymous ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3 space-y-4">
        <div className="space-y-1">
          <Input
            placeholder="Title"
            className="bg-muted/50 border-muted focus:bg-background transition-colors text-sm font-medium placeholder:text-muted-foreground/60"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground px-3">
            {title.length}/100 characters
          </p>
        </div>
        <div className="space-y-1">
          <Textarea
            placeholder="What's on your heart? Share your prayer request..."
            className="min-h-[120px] resize-none bg-muted/50 border-muted focus:bg-background transition-colors text-sm leading-6 placeholder:text-muted-foreground/60"
            value={prayerText}
            onChange={(e) => setPrayerText(e.target.value)}
          />
          {prayerText.length > 0 && (
            <p className="text-xs text-muted-foreground px-3">
              {prayerText.split(/\s+/).filter(word => word.length > 0).length} words
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center pt-0">
        <p className="text-xs text-muted-foreground">
          {isAnonymous ? "Anonymous post" : "Public post"}
        </p>
        <Button 
          onClick={handleSubmit} 
          disabled={!title.trim() || !prayerText.trim() || isSubmitting}
          size="sm"
        >
          {isSubmitting ? "Sharing..." : "Share"}
        </Button>
      </CardFooter>
    </Card>
    </SignedIn>
  );
}
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Eye, EyeOff } from "lucide-react";
import { useUser, SignedIn } from "@clerk/nextjs";

export function CreatePrayer() {
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [prayerText, setPrayerText] = useState("");
  const { user } = useUser();

  const handleSubmit = () => {
    console.log({ prayerText, isAnonymous, userId: user?.id });
    setPrayerText("");
  };

  return (
    <SignedIn>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.imageUrl} alt="You" />
              <AvatarFallback>
                {isAnonymous ? "?" : user?.firstName?.charAt(0) || <User className="h-4 w-4" />}
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
      <CardContent className="pt-0 pb-3">
        <Textarea
          placeholder="What would you like prayer for?"
          className="min-h-[100px] resize-none border-0 px-0 focus-visible:ring-0 text-sm leading-6"
          value={prayerText}
          onChange={(e) => setPrayerText(e.target.value)}
        />
      </CardContent>
      <CardFooter className="flex justify-between items-center pt-0">
        <p className="text-xs text-muted-foreground">
          {isAnonymous ? "Anonymous post" : "Public post"}
        </p>
        <Button 
          onClick={handleSubmit} 
          disabled={!prayerText.trim()}
          size="sm"
        >
          Share
        </Button>
      </CardFooter>
    </Card>
    </SignedIn>
  );
}
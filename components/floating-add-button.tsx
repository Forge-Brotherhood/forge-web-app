"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreatePrayerModal } from "@/components/create-prayer-modal";
import { useAuth } from "@clerk/nextjs";

export function FloatingAddButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isSignedIn, isLoaded } = useAuth();

  // Don't render if user is not signed in or still loading
  if (!isSignedIn || !isLoaded) {
    return null;
  }

  return (
    <>
      <Button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow z-40"
        size="icon"
        aria-label="Add new prayer request"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Share a Prayer Request</DialogTitle>
          </DialogHeader>
          <CreatePrayerModal 
            onClose={() => setIsModalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
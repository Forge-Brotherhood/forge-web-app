"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CreatePrayerModal } from "@/components/create-prayer-modal";
import { useRouter } from "next/navigation";

export default function CreatePrayerPage() {
  const router = useRouter();

  const handleClose = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="mr-4"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Share a Prayer Request</h1>
        </div>

        {/* Prayer Creation Form */}
        <div className="bg-card rounded-lg border p-6 shadow-sm">
          <CreatePrayerModal onClose={handleClose} />
        </div>
      </div>
    </div>
  );
}
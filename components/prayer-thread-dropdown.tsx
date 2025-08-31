"use client";

import { useState } from "react";
import { MoreHorizontal, Trash2, Flag, EyeOff, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

interface PrayerThreadDropdownProps {
  isOwner: boolean;
  isSignedIn: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function PrayerThreadDropdown({
  isOwner,
  isSignedIn,
  onDelete,
  isDeleting = false,
  onClick,
}: PrayerThreadDropdownProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.();
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8" 
            onClick={handleDropdownClick}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem className="text-sm">
            <Flag className="h-4 w-4 mr-3" />
            Report
          </DropdownMenuItem>
          <DropdownMenuItem className="text-sm">
            <EyeOff className="h-4 w-4 mr-3" />
            Hide
          </DropdownMenuItem>
          <DropdownMenuItem className="text-sm">
            <Link className="h-4 w-4 mr-3" />
            Copy link
          </DropdownMenuItem>
          {isSignedIn && isOwner && (
            <DropdownMenuItem
              className="text-destructive text-sm"
              onClick={handleDeleteClick}
            >
              <Trash2 className="h-4 w-4 mr-3" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Prayer Request"
        description={
          <>
            Are you sure you want to delete this prayer request? This action cannot be undone.
            <br /><br />
            All encouragements, updates, and prayers associated with this request will be permanently removed.
          </>
        }
        confirmText="Delete Prayer Request"
        confirmVariant="destructive"
        loading={isDeleting}
        loadingText="Deleting..."
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
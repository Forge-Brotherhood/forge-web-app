"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";

export function useThreadActions() {
  const { isSignedIn } = useAuth();
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const setLoading = (threadId: string, loading: boolean) => {
    setActionLoading(prev => ({ ...prev, [threadId]: loading }));
  };

  const addPrayer = useCallback(async (threadId: string) => {
    if (!isSignedIn) {
      throw new Error("You must be signed in to pray");
    }

    setLoading(threadId, true);
    try {
      const response = await fetch(`/api/threads/${threadId}/prayers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add prayer");
      }

      return await response.json();
    } catch (error) {
      console.error("Error adding prayer:", error);
      throw error;
    } finally {
      setLoading(threadId, false);
    }
  }, [isSignedIn]);

  const addEncouragement = useCallback(async (threadId: string, body: string) => {
    if (!isSignedIn) {
      throw new Error("You must be signed in to encourage");
    }

    if (!body.trim()) {
      throw new Error("Encouragement cannot be empty");
    }

    setLoading(threadId, true);
    try {
      const response = await fetch(`/api/threads/${threadId}/encouragements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: body.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add encouragement");
      }

      return await response.json();
    } catch (error) {
      console.error("Error adding encouragement:", error);
      throw error;
    } finally {
      setLoading(threadId, false);
    }
  }, [isSignedIn]);

  const addToCart = useCallback(async (threadId: string) => {
    if (!isSignedIn) {
      throw new Error("You must be signed in to follow prayers");
    }

    setLoading(threadId, true);
    try {
      // This would be a new endpoint we need to create
      const response = await fetch(`/api/threads/${threadId}/cart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add to prayer cart");
      }

      return await response.json();
    } catch (error) {
      console.error("Error adding to cart:", error);
      throw error;
    } finally {
      setLoading(threadId, false);
    }
  }, [isSignedIn]);

  const removeFromCart = useCallback(async (threadId: string) => {
    if (!isSignedIn) {
      throw new Error("You must be signed in to unfollow prayers");
    }

    setLoading(threadId, true);
    try {
      // This would be a new endpoint we need to create
      const response = await fetch(`/api/threads/${threadId}/cart`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to remove from prayer cart");
      }

      return await response.json();
    } catch (error) {
      console.error("Error removing from cart:", error);
      throw error;
    } finally {
      setLoading(threadId, false);
    }
  }, [isSignedIn]);

  return {
    addPrayer,
    addEncouragement,
    addToCart,
    removeFromCart,
    actionLoading,
    isSignedIn,
  };
}
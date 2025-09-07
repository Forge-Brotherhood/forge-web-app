"use client";

import React from "react";

interface GroupNewPostProps {
  groupId: string;
  onSubmit: () => void;
}

export function GroupNewPost({ groupId, onSubmit }: GroupNewPostProps) {
  // This component is no longer needed since we have a global share page
  return null;
}
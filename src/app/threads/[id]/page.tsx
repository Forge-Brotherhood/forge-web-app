import { ThreadDetailClient } from "./thread-detail-client";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  
  // Basic metadata - detailed data will be fetched client-side
  return {
    title: "Prayer Thread - Forge",
    description: "Join in prayer and encouragement with the community",
  };
}

export default async function ThreadPage({ params }: PageProps) {
  const { id } = await params;
  
  return <ThreadDetailClient threadId={id} />;
}
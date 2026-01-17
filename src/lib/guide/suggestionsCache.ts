import { createHash } from "crypto";
import { CacheKeys, getKVClient } from "@/lib/kv";

export const GUIDE_SUGGESTIONS_CACHE_TTL_SECONDS = 8 * 60 * 60;

export type CachedGuideSuggestions = {
  // NDJSON lines without trailing newline; replayed as `line + "\n"`.
  ndjsonLines: string[];
};

export const makeGuideSuggestionsCacheKey = (args: {
  userId: string;
  enabledActions: string[];
  // bump this whenever prompt/schema materially changes and you want a cold cache
  cacheVersion?: string;
}): string => {
  const stable = {
    v: args.cacheVersion ?? "v1",
    enabledActions: [...args.enabledActions].sort(),
  };
  const hash = createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 24);
  return CacheKeys.guideSuggestions(args.userId, hash);
};

export async function getCachedGuideSuggestions(key: string): Promise<CachedGuideSuggestions | null> {
  const kv = getKVClient();
  const hit = await kv.get<CachedGuideSuggestions>(key);
  return hit?.data ?? null;
}

export async function setCachedGuideSuggestions(key: string, value: CachedGuideSuggestions): Promise<void> {
  const kv = getKVClient();
  await kv.set(key, value, GUIDE_SUGGESTIONS_CACHE_TTL_SECONDS);
}



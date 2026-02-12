/**
 * Life Context Fetcher
 *
 * Fetches user's life context (season, carrying, hoping) from aiContext.
 */

import type { ContextCandidate, LifeContextFetcherOptions } from "./types";
import { createRedactedPreview } from "./helpers";

type UserLifeContext = {
  currentSeason?: string;
  weeklyIntention?: {
    carrying?: string;
    hoping?: string;
  };
};

type UserContext = {
  lifeContext?: UserLifeContext;
};

/**
 * Fetch life context candidates from user's aiContext.
 */
export async function fetchLifeContext(
  options: LifeContextFetcherOptions
): Promise<ContextCandidate[]> {
  const candidates: ContextCandidate[] = [];

  // Get from aiContext if available
  const userContext = options.aiContext?.userContext as UserContext | undefined;
  const lifeContext = userContext?.lifeContext;

  if (lifeContext?.currentSeason) {
    candidates.push({
      id: `life:${options.userId}:season`,
      source: "life_context",
      label: "Current Season",
      preview: createRedactedPreview(String(lifeContext.currentSeason)),
      metadata: {
        type: "season",
        value: lifeContext.currentSeason,
      },
    });
  }

  const weeklyIntention = lifeContext?.weeklyIntention;

  if (weeklyIntention?.carrying) {
    candidates.push({
      id: `life:${options.userId}:carrying`,
      source: "life_context",
      label: "What You're Carrying",
      preview: createRedactedPreview(String(weeklyIntention.carrying)),
      metadata: {
        type: "carrying",
        value: weeklyIntention.carrying,
      },
    });
  }

  if (weeklyIntention?.hoping) {
    candidates.push({
      id: `life:${options.userId}:hoping`,
      source: "life_context",
      label: "What You're Hoping For",
      preview: createRedactedPreview(String(weeklyIntention.hoping)),
      metadata: {
        type: "hoping",
        value: weeklyIntention.hoping,
      },
    });
  }

  return candidates;
}

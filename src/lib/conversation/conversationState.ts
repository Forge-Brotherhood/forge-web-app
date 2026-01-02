/**
 * Conversation State Service
 *
 * Manages rolling conversation state with database persistence.
 * Replaces the in-memory compactor.ts approach.
 *
 * Features:
 * - Persists state per conversation in database
 * - Keeps last N messages for immediate context
 * - Generates rolling summaries when messages overflow
 * - Uses fast model (gpt-4o-mini) for summarization
 */

import { prisma } from "@/lib/prisma";
import { MEMORY_CONFIG } from "@/lib/memory/vocabularies";

// =============================================================================
// Types
// =============================================================================

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
};

export type ConversationStateData = {
  summary: string;
  recentMessages: ConversationMessage[];
  turnCount: number;
};

// =============================================================================
// Public API
// =============================================================================

type UpdateConversationStateOptions = {
  /**
   * When true, may call OpenAI to generate rolling summaries if messages overflow.
   * When false, skips summarization to keep the update fast and low-risk (good for hot paths).
   */
  shouldSummarize: boolean;
};

const isConversationMessage = (value: unknown): value is ConversationMessage => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  const role = record.role;
  if (role !== "user" && role !== "assistant") return false;

  if (typeof record.content !== "string") return false;

  const timestamp = record.timestamp;
  if (timestamp !== undefined && typeof timestamp !== "string") return false;

  return true;
};

const parseConversationMessages = (value: unknown): ConversationMessage[] => {
  if (!Array.isArray(value)) return [];

  const messages: ConversationMessage[] = [];
  for (const item of value) {
    if (!isConversationMessage(item)) continue;
    messages.push({
      role: item.role,
      content: item.content,
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
    });
  }

  return messages;
};

/**
 * Get the current conversation state
 */
export async function getConversationState(
  conversationId: string,
  userId: string
): Promise<ConversationStateData | null> {
  const state = await prisma.conversationState.findUnique({
    where: { conversationId },
  });

  if (!state || state.userId !== userId) {
    return null;
  }

  return {
    summary: state.summary,
    recentMessages: parseConversationMessages(state.recentMessages as unknown),
    turnCount: state.turnCount,
  };
}

/**
 * Update conversation state after a turn
 * Handles message windowing and summary generation
 */
export async function updateConversationState(
  conversationId: string,
  userId: string,
  newUserMessage: string,
  newAssistantMessage: string
): Promise<void> {
  await updateConversationStateInternal(conversationId, userId, newUserMessage, newAssistantMessage, {
    shouldSummarize: true,
  });
}

/**
 * Fast update version meant for hot API paths.
 * Skips summary generation to minimize DB + network pressure.
 */
export async function updateConversationStateFast(
  conversationId: string,
  userId: string,
  newUserMessage: string,
  newAssistantMessage: string
): Promise<void> {
  await updateConversationStateInternal(conversationId, userId, newUserMessage, newAssistantMessage, {
    shouldSummarize: false,
  });
}

async function updateConversationStateInternal(
  conversationId: string,
  userId: string,
  newUserMessage: string,
  newAssistantMessage: string,
  options: UpdateConversationStateOptions
): Promise<void> {
  const existing = await prisma.conversationState.findUnique({
    where: { conversationId },
    select: {
      userId: true,
      summary: true,
      recentMessages: true,
      turnCount: true,
    },
  });

  const now = new Date().toISOString();
  const newMessages: ConversationMessage[] = [
    { role: "user", content: newUserMessage, timestamp: now },
    { role: "assistant", content: newAssistantMessage, timestamp: now },
  ];

  if (!existing) {
    // Create new state
    await prisma.conversationState.create({
      data: {
        conversationId,
        userId,
        summary: "",
        recentMessages: newMessages,
        turnCount: 1,
      },
    });
    return;
  }

  // Update existing state
  const currentMessages = parseConversationMessages(existing.recentMessages as unknown);
  const allMessages = [...currentMessages, ...newMessages];

  // Keep only recent messages within limit
  const recentMessages = allMessages.slice(-MEMORY_CONFIG.MAX_RECENT_MESSAGES);

  // Generate new summary if we're dropping messages
  let summary = existing.summary;
  if (allMessages.length > MEMORY_CONFIG.MAX_RECENT_MESSAGES) {
    const droppedMessages = allMessages.slice(0, -MEMORY_CONFIG.MAX_RECENT_MESSAGES);
    if (options.shouldSummarize) {
      summary = await generateIncrementalSummary(existing.summary, droppedMessages);
    }
  }

  await prisma.conversationState.update({
    where: { conversationId },
    data: {
      summary,
      recentMessages,
      turnCount: { increment: 1 },
      lastSummaryAt: new Date(),
    },
  });
}

/**
 * Build messages array for model call, including summary context
 */
export function buildMessagesWithState(
  state: ConversationStateData | null,
  newUserMessage: string
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  // Add summary as context if present
  if (state?.summary) {
    messages.push({
      role: "assistant",
      content: `[Previous conversation context: ${state.summary}]`,
    });
  }

  // Add recent messages
  if (state?.recentMessages) {
    messages.push(...state.recentMessages);
  }

  // Add new user message
  messages.push({
    role: "user",
    content: newUserMessage,
  });

  return messages;
}

/**
 * Delete conversation state (for cleanup or user request)
 */
export async function deleteConversationState(
  conversationId: string
): Promise<void> {
  await prisma.conversationState.delete({
    where: { conversationId },
  }).catch(() => {
    // Ignore if doesn't exist
  });
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Generate an incremental summary incorporating new messages
 */
async function generateIncrementalSummary(
  existingSummary: string,
  newMessages: ConversationMessage[]
): Promise<string> {
  if (newMessages.length === 0) {
    return existingSummary;
  }

  const prompt = buildSummaryPrompt(existingSummary, newMessages);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: SUMMARY_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.error("[ConversationState] Summary generation failed:", await response.text());
      return existingSummary; // Keep existing on failure
    }

    const data = await response.json();
    const newSummary = data.choices?.[0]?.message?.content;

    return newSummary || existingSummary;
  } catch (error) {
    console.error("[ConversationState] Summary generation error:", error);
    return existingSummary;
  }
}

const SUMMARY_SYSTEM_PROMPT = `You summarize Bible study conversations for context continuity.

Guidelines:
- Preserve key spiritual insights and reflections the user shared
- Note any specific struggles, questions, or growth moments
- Keep relevant scripture references mentioned
- Maintain emotional context (was user struggling, encouraged, seeking, etc.)
- Maximum 200 words
- Write in third person ("The user discussed..." not "You discussed...")`;

function buildSummaryPrompt(
  existingSummary: string,
  newMessages: ConversationMessage[]
): string {
  const messagesText = newMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  if (existingSummary) {
    return `Current summary:
${existingSummary}

New messages to incorporate:
${messagesText}

Create an updated summary that merges the existing context with the new information:`;
  }

  return `Messages to summarize:
${messagesText}

Create a summary of this Bible study conversation:`;
}

/**
 * Estimate token count for conversation (rough heuristic)
 */
export function estimateTokens(messages: ConversationMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4); // ~4 chars per token
}

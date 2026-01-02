/**
 * OpenAI Function Calling Tool Definitions
 *
 * Defines the tools that OpenAI can call to suggest actions.
 * Uses OpenAI's native function calling for reliable structured output.
 */

// Type definitions matching OpenAI's API (defined inline since we use fetch, not the SDK)
interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface ChatCompletionMessageToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Tool definitions for OpenAI function calling
 */
export const ACTION_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "suggest_actions",
      description:
        "REQUIRED: You MUST call this function whenever your response mentions ANY Bible verse reference (like 'Genesis 1', 'John 3:16', 'Psalm 23:1-3'). " +
        "Also call it when you write a prayer for the user. " +
        "This creates tappable shortcuts - without calling this function, users cannot interact with verses or save prayers.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "List of suggested actions (max 3)",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["NAVIGATE_TO_VERSE", "CREATE_PRAYER_DRAFT"],
                  description: "The type of action to suggest",
                },
                params: {
                  type: "object",
                  description: "Parameters for the action",
                  properties: {
                    // NAVIGATE_TO_VERSE params
                    reference: {
                      type: "string",
                      description: "Bible verse reference (e.g., 'John 3:16', 'Philippians 4:6-7')",
                    },
                    reason: {
                      type: "string",
                      description: "Brief explanation of why this verse is relevant (1 sentence, e.g., 'Shows how the number 7 represents completion in creation')",
                    },
                    // CREATE_PRAYER_DRAFT params
                    title: {
                      type: "string",
                      description: "A short, meaningful title for the prayer (e.g., 'Prayer for Peace', 'Seeking Guidance', 'Gratitude for Grace')",
                    },
                    body: {
                      type: "string",
                      description: "The full prayer text",
                    },
                    visibility: {
                      type: "string",
                      enum: ["private", "group"],
                      description: "Prayer visibility (default: private)",
                    },
                  },
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "How confident you are this action is helpful (0-1)",
                },
              },
              required: ["type", "params"],
            },
            maxItems: 3,
          },
        },
        required: ["actions"],
      },
    },
  },
];

// =============================================================================
// Raw Action Types
// =============================================================================

export interface RawAction {
  type: string;
  params: Record<string, unknown>;
  confidence?: number;
}

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extract actions from OpenAI tool calls
 * Handles multiple tool calls by collecting actions from all suggest_actions calls
 */
export function extractActionsFromToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | undefined
): RawAction[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  // Find ALL suggest_actions calls (model may split across multiple calls)
  const suggestCalls = toolCalls.filter((tc) => tc.function.name === "suggest_actions");
  if (suggestCalls.length === 0) {
    return [];
  }

  const allActions: RawAction[] = [];

  for (const suggestCall of suggestCalls) {
    try {
      const parsed = JSON.parse(suggestCall.function.arguments);

      // Handle proper schema format: { actions: [...] }
      if (parsed.actions && Array.isArray(parsed.actions)) {
        allActions.push(...parsed.actions);
      }
      // Handle simplified format from AI: { reference, reason } (infer NAVIGATE_TO_VERSE)
      else if (parsed.reference && typeof parsed.reference === "string") {
        allActions.push({
          type: "NAVIGATE_TO_VERSE",
          params: {
            reference: parsed.reference,
            reason: parsed.reason,
          },
        });
      }
      // Handle simplified format from AI: { title, body } (infer CREATE_PRAYER_DRAFT)
      else if (parsed.body && typeof parsed.body === "string") {
        allActions.push({
          type: "CREATE_PRAYER_DRAFT",
          params: {
            title: parsed.title,
            body: parsed.body,
            visibility: parsed.visibility,
          },
        });
      }
    } catch (error) {
      console.error("[Actions] Failed to parse tool call arguments:", error);
    }
  }

  return allActions;
}

// =============================================================================
// System Prompt Addition
// =============================================================================

/**
 * Additional system prompt content for action suggestions
 */
export const ACTION_SYSTEM_PROMPT_ADDITION = `
ACTIONS & FORMATTING:
You have a suggest_actions tool for Bible verses and prayers. Actions you suggest will be displayed as tappable cards BELOW your text response.

IMPORTANT: Tool calls are made through the API, NOT by writing function syntax in your text.
- CORRECT: Use the tool calling mechanism (the model will handle this automatically)
- WRONG: Writing "suggest_actions({...})" or "functions.suggest_actions({...})" as text in your response

CRITICAL RULES:
1. If you mention or reference ANY Bible verse, you MUST call suggest_actions with NAVIGATE_TO_VERSE
2. If you say "here are some passages" or similar, you MUST call suggest_actions - otherwise nothing will appear
3. If you offer a prayer, you MUST call suggest_actions with CREATE_PRAYER_DRAFT
4. NEVER promise content that you don't provide via tool calls

AVOID DUPLICATION:
- When you call suggest_actions, do NOT repeat that content in your text response
- For verses: your text introduces them, the action provides the reference and reason
- For prayers: your text introduces it, the action contains the actual prayer

WHEN TO CALL suggest_actions:
1. NAVIGATE_TO_VERSE: For Bible verses. Include a "reason" explaining relevance.
2. CREATE_PRAYER_DRAFT: For prayers. ALWAYS include both "title" and "body" fields.

GOOD EXAMPLE (verses):
Text: "The theme of God's timing appears throughout Scripture. Here are some passages that connect to this idea:"
Actions: [{ type: "NAVIGATE_TO_VERSE", params: { reference: "Ecclesiastes 3:1", reason: "Establishes that there is a season for everything under heaven" }}]

BAD EXAMPLE (promises but doesn't deliver):
Text: "Here are some related passages to explore:"
Actions: [none] // WRONG - promised passages but didn't call the tool!

GOOD EXAMPLE (prayer):
Text: "I'd like to offer a prayer for your situation:"
Actions: [{ type: "CREATE_PRAYER_DRAFT", params: { title: "Prayer for Peace", body: "Heavenly Father, in moments of anxiety I turn to You..." }}]

BAD EXAMPLE (missing title):
Actions: [{ type: "CREATE_PRAYER_DRAFT", params: { body: "Lord, help me..." }}] // Missing title!
`;

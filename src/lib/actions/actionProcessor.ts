/**
 * Action Processor
 *
 * Validates, resolves, and processes raw actions from the AI.
 * Treats AI output as untrusted and validates against the action catalog.
 */

import {
  ACTION_CATALOG,
  ActionType,
  isValidActionType,
  getActionSchema,
  getActionDefinition,
} from "./actionCatalog";
import { RawAction } from "./actionTools";

// =============================================================================
// Types
// =============================================================================

export interface ValidatedAction {
  id: string;
  type: ActionType;
  version: number;
  params: Record<string, unknown>;
  resolved?: Record<string, unknown>;
  confidence?: number;
  priority: "primary" | "secondary" | "inline";
  // Rendering hints (passed through from catalog)
  icon: string;
  color: string;
}

export interface ActionProcessorResult {
  actions: ValidatedAction[];
  dropped: DroppedAction[];
}

export interface DroppedAction {
  type: string;
  reason: string;
  params?: Record<string, unknown>;
}

export interface ActionContext {
  userId: string;
  // Feature flags, permissions, etc. can be added here
}

// =============================================================================
// Main Processor
// =============================================================================

/**
 * Process raw actions from AI output into validated actions
 */
export async function processActions(
  rawActions: RawAction[],
  context: ActionContext
): Promise<ActionProcessorResult> {
  const validated: ValidatedAction[] = [];
  const dropped: DroppedAction[] = [];

  for (const raw of rawActions) {
    try {
      const result = await processOneAction(raw, context);
      if (result.valid) {
        validated.push(result.action!);
      } else {
        dropped.push(result.dropped!);
      }
    } catch (error) {
      dropped.push({
        type: raw.type,
        reason: `Processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
        params: raw.params,
      });
    }
  }

  // Sort by priority (primary first, then secondary, then inline)
  const priorityOrder = { primary: 0, secondary: 1, inline: 2 };
  validated.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Limit to max 3 actions
  const limited = validated.slice(0, 3);
  if (validated.length > 3) {
    for (let i = 3; i < validated.length; i++) {
      dropped.push({
        type: validated[i].type,
        reason: "Exceeded max action limit (3)",
        params: validated[i].params,
      });
    }
  }

  return { actions: limited, dropped };
}

// =============================================================================
// Single Action Processing
// =============================================================================

interface ProcessResult {
  valid: boolean;
  action?: ValidatedAction;
  dropped?: DroppedAction;
}

async function processOneAction(
  raw: RawAction,
  context: ActionContext
): Promise<ProcessResult> {
  // 1. Check if action type is known
  if (!isValidActionType(raw.type)) {
    return {
      valid: false,
      dropped: {
        type: raw.type,
        reason: `Unknown action type: ${raw.type}`,
        params: raw.params,
      },
    };
  }

  const actionType = raw.type as ActionType;
  const definition = getActionDefinition(actionType);

  // 2. Validate params against schema
  const schema = getActionSchema(actionType);
  const parseResult = schema.safeParse(raw.params);

  if (!parseResult.success) {
    return {
      valid: false,
      dropped: {
        type: raw.type,
        reason: `Invalid params: ${parseResult.error.message}`,
        params: raw.params,
      },
    };
  }

  const validatedParams = parseResult.data as Record<string, unknown>;

  // 3. Resolve params (e.g., parse verse references)
  let resolved: Record<string, unknown> | undefined;
  if (definition.resolve) {
    try {
      resolved = await definition.resolve(validatedParams);
    } catch (error) {
      // Resolution failure is not fatal - action can still work
      console.warn(`[Actions] Resolution failed for ${actionType}:`, error);
    }
  }

  // 4. Authorization checks (can be expanded)
  const authResult = await authorizeAction(actionType, validatedParams, context);
  if (!authResult.authorized) {
    return {
      valid: false,
      dropped: {
        type: raw.type,
        reason: authResult.reason || "Unauthorized",
        params: raw.params,
      },
    };
  }

  // 5. Build validated action
  const action: ValidatedAction = {
    id: generateActionId(actionType, validatedParams),
    type: actionType,
    version: definition.version,
    params: validatedParams,
    resolved,
    confidence: raw.confidence,
    priority: definition.priority,
    icon: definition.icon,
    color: definition.color,
  };

  return { valid: true, action };
}

// =============================================================================
// Authorization
// =============================================================================

interface AuthResult {
  authorized: boolean;
  reason?: string;
}

async function authorizeAction(
  type: ActionType,
  params: Record<string, unknown>,
  context: ActionContext
): Promise<AuthResult> {
  // Action-specific authorization rules can be added here
  // Currently all actions are authorized for the user
  return { authorized: true };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate a unique ID for an action
 */
function generateActionId(type: ActionType, params: Record<string, unknown>): string {
  // Create a stable ID based on type and key params
  const key = type === "NAVIGATE_TO_VERSE"
    ? params.reference
    : type === "CREATE_PRAYER_DRAFT"
      ? params.body?.toString().slice(0, 50)
      : JSON.stringify(params).slice(0, 50);

  return `${type}-${hashCode(String(key))}`;
}

/**
 * Simple hash function for ID generation
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Actions Module
 *
 * Extensible action system for AI-suggested CTAs.
 */

// Catalog
export {
  ACTION_CATALOG,
  ACTION_TYPES,
  isValidActionType,
  getActionSchema,
  getActionDefinition,
} from "./actionCatalog";
export type { ActionType, ActionDefinition } from "./actionCatalog";

// Tools (OpenAI function calling)
export {
  ACTION_TOOLS,
  extractActionsFromToolCalls,
  ACTION_SYSTEM_PROMPT_ADDITION,
} from "./actionTools";
export type { RawAction } from "./actionTools";

// Processor
export { processActions } from "./actionProcessor";
export type {
  ValidatedAction,
  ActionProcessorResult,
  DroppedAction,
  ActionContext,
} from "./actionProcessor";

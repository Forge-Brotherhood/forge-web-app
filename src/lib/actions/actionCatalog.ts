/**
 * Action Catalog
 *
 * Central registry of all action types the AI can suggest.
 * Each action has a schema for validation and optional resolution logic.
 */

import { z } from "zod";
import { parseReference, ParsedReference } from "@/lib/bibleReference";

// =============================================================================
// Action Type Definitions
// =============================================================================

export const ACTION_CATALOG = {
  /**
   * Navigate to a verse in the Bible reader
   */
  NAVIGATE_TO_VERSE: {
    version: 1,
    description: "Open a verse in the Bible reader",
    schema: z.object({
      reference: z.string().min(1), // e.g., "John 3:16", "Philippians 4:6-7"
      reason: z.string().optional(), // Brief explanation of why this verse is relevant
      translation: z.string().optional(), // e.g., "BSB", "KJV"
    }),
    resolve: async (params: { reference: string; reason?: string; translation?: string }) => {
      const parsed = parseReference(params.reference);
      return {
        ...params,
        resolved: parsed,
      };
    },
    // Rendering hints
    icon: "book.fill",
    color: "orange",
    priority: "secondary" as const,
  },

  /**
   * Open prayer composer with pre-filled content
   */
  CREATE_PRAYER_DRAFT: {
    version: 1,
    description: "Open prayer composer with pre-filled content",
    schema: z.object({
      title: z.string().min(1), // Required - AI should always provide a meaningful title
      body: z.string().min(1),
      visibility: z.enum(["private", "community"]).default("private"),
    }),
    resolve: async (params: { title: string; body: string; visibility?: string }) => {
      return { ...params };
    },
    icon: "hands.sparkles.fill",
    color: "purple",
    priority: "primary" as const,
  },
} as const;

// =============================================================================
// Type Exports
// =============================================================================

export type ActionType = keyof typeof ACTION_CATALOG;

export const ACTION_TYPES = Object.keys(ACTION_CATALOG) as ActionType[];

export interface ActionDefinition {
  version: number;
  description: string;
  schema: z.ZodSchema;
  resolve?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  icon: string;
  color: string;
  priority: "primary" | "secondary" | "inline";
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if an action type is valid
 */
export function isValidActionType(type: string): type is ActionType {
  return type in ACTION_CATALOG;
}

/**
 * Get the schema for an action type
 */
export function getActionSchema(type: ActionType): z.ZodSchema {
  return ACTION_CATALOG[type].schema;
}

/**
 * Get action definition by type
 */
export function getActionDefinition(type: ActionType): ActionDefinition {
  // Cast through unknown since catalog entries have specific param types
  // but ActionDefinition uses Record<string, unknown> for flexibility
  return ACTION_CATALOG[type] as unknown as ActionDefinition;
}


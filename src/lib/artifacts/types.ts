/**
 * Artifact Types
 *
 * Type definitions for the artifacts system.
 */

// =============================================================================
// Constants
// =============================================================================

export const ARTIFACT_TYPES = [
  "conversation_session_summary",
  "journal_entry",
  "prayer_request",
  "prayer_update",
  "testimony",
  "verse_highlight",
  "verse_note",
  "bible_reading_session",
] as const;

export const ARTIFACT_SCOPES = ["private", "global"] as const;

export const ARTIFACT_RELATIONS = [
  "follows_up",
  "summarizes",
  "references",
  "part_of_thread",
] as const;

export const ARTIFACT_STATUSES = ["active", "deleted"] as const;

// Guardrails
export const MIN_MESSAGES_FOR_SUMMARY = 2;
export const MAX_SUMMARY_CHARS = 800;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;

// =============================================================================
// Enums (derived from constants)
// =============================================================================

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number];
export type ArtifactRelation = (typeof ARTIFACT_RELATIONS)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

// =============================================================================
// Embedding eligibility
// =============================================================================

export const EMBEDDABLE_ARTIFACT_TYPES = [
  "conversation_session_summary",
  "verse_note",
  "journal_entry",
  "prayer_request",
  "prayer_update",
  "testimony",
  "bible_reading_session",
] as const satisfies readonly ArtifactType[];

const EMBEDDABLE_ARTIFACT_TYPE_SET = new Set<ArtifactType>(
  EMBEDDABLE_ARTIFACT_TYPES
);

export function shouldEmbedArtifactType(type: ArtifactType): boolean {
  return EMBEDDABLE_ARTIFACT_TYPE_SET.has(type);
}

// =============================================================================
// Core Types
// =============================================================================

export interface Artifact {
  id: string;
  userId: string | null;
  conversationId: string | null;
  sessionId: string | null;

  type: ArtifactType;
  scope: ArtifactScope;
  title: string | null;
  content: string;

  scriptureRefs: string[] | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;

  status: ArtifactStatus;
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: ArtifactRelation;
  createdAt: Date;
}

export interface ArtifactEmbedding {
  id: string;
  artifactId: string;
  model: string;
  dimension: number;
  vector: Buffer;
  createdAt: Date;
}

// =============================================================================
// Input Types
// =============================================================================

export interface CreateArtifactInput {
  userId?: string;
  conversationId?: string;
  sessionId?: string;

  type: ArtifactType;
  scope: ArtifactScope;
  title?: string;
  content: string;

  scriptureRefs?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateArtifactInput {
  title?: string;
  content?: string;
  scriptureRefs?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateEdgeInput {
  fromId: string;
  toId: string;
  relation: ArtifactRelation;
}

// =============================================================================
// Filter Types
// =============================================================================

export interface ArtifactFilters {
  userId?: string;
  sessionId?: string;
  conversationId?: string;

  types?: ArtifactType[];
  scopes?: ArtifactScope[];
  status?: ArtifactStatus;

  createdAfter?: Date;
  createdBefore?: Date;

  scriptureRef?: string;
  tag?: string;

  limit?: number;
  offset?: number;
}

// =============================================================================
// Search Types
// =============================================================================

export interface SemanticSearchParams {
  query: string;
  filters: ArtifactFilters;
  topK?: number;
}

export interface SearchResult {
  artifact: Artifact;
  score: number;
}

// =============================================================================
// Thread Types
// =============================================================================

export interface ArtifactWithEdges extends Artifact {
  edgesFrom: ArtifactEdge[];
  edgesTo: ArtifactEdge[];
}

export interface ThreadResult {
  artifacts: Artifact[];
  edges: ArtifactEdge[];
}

// =============================================================================
// Prompt Injection Format
// =============================================================================

export interface ArtifactSnippet {
  type: ArtifactType;
  date: string;
  preview: string;
  scriptureRef?: string;
}

// =============================================================================
// Type-Specific Metadata
// =============================================================================

/**
 * Metadata for verse_highlight artifacts.
 * Used when a user underlines/highlights a verse in the Bible reader.
 */
export interface VerseHighlightMetadata {
  bibleVersion: string; // e.g. "ESV"
  reference: {
    book: string; // e.g. "John"
    chapter: number;
    verseStart: number;
    verseEnd: number;
  };
  // Underline is implied for highlights in this app; no `kind`/`thickness`.
  style: {
    color: string; // e.g. "yellow"
  };
  source?: {
    planId: string;
    planDayIndex: number;
  };
}

/**
 * Metadata for verse_note artifacts.
 * Used when a user creates a note on a Bible verse.
 */
export interface VerseNoteMetadata {
  noteId: string; // ID of the VerseNote record (linkage to source table)
  bibleVersion: string; // e.g. "ESV"
  reference: {
    book: string; // e.g. "John"
    chapter: number;
    verseStart: number;
    verseEnd: number;
  };
  isPrivate: boolean;
  source?: {
    planId: string;
    planDayIndex: number;
  };
  /** LLM-generated theme summary (~30 words, no PII) */
  noteSummary?: string;
  /** LLM-generated topic tags for retrieval */
  noteTags?: string[];
}

// =============================================================================
// Type Guards
// =============================================================================

export function isValidArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPES.includes(value as ArtifactType);
}

export function isValidArtifactScope(value: string): value is ArtifactScope {
  return ARTIFACT_SCOPES.includes(value as ArtifactScope);
}

export function isValidArtifactRelation(
  value: string
): value is ArtifactRelation {
  return ARTIFACT_RELATIONS.includes(value as ArtifactRelation);
}

export function isValidArtifactStatus(value: string): value is ArtifactStatus {
  return ARTIFACT_STATUSES.includes(value as ArtifactStatus);
}

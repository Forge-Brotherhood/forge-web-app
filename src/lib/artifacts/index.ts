/**
 * Artifacts Module
 *
 * User content artifacts with retrieval and relationship support.
 */

// Types
export type {
  Artifact,
  ArtifactEdge,
  ArtifactEmbedding,
  ArtifactType,
  ArtifactScope,
  ArtifactRelation,
  ArtifactStatus,
  CreateArtifactInput,
  UpdateArtifactInput,
  CreateEdgeInput,
  ArtifactFilters,
  SemanticSearchParams,
  SearchResult,
  ArtifactWithEdges,
  ThreadResult,
  ArtifactSnippet,
} from "./types";

export {
  ARTIFACT_TYPES,
  ARTIFACT_SCOPES,
  ARTIFACT_RELATIONS,
  ARTIFACT_STATUSES,
  MIN_MESSAGES_FOR_SUMMARY,
  MAX_SUMMARY_CHARS,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSION,
  isValidArtifactType,
  isValidArtifactScope,
  isValidArtifactRelation,
  isValidArtifactStatus,
  EMBEDDABLE_ARTIFACT_TYPES,
  shouldEmbedArtifactType,
} from "./types";

// Artifact CRUD
export {
  createArtifact,
  getArtifact,
  listArtifacts,
  updateArtifact,
  deleteArtifact,
  getArtifactsBySession,
  countArtifacts,
} from "./artifactService";

// Edge operations
export {
  createEdge,
  getEdge,
  getEdgesFrom,
  getEdgesTo,
  getThread,
  getFollowUpChain,
  getSummariesFor,
  deleteEdge,
  deleteEdgesForArtifact,
} from "./edgeService";

// Embedding operations
export {
  embedArtifact,
  removeEmbedding,
  searchSimilar,
  hasEmbedding,
  getEmbeddingStats,
} from "./embeddingService";

// Retrieval operations
export {
  retrieveForContext,
  retrieveByScripture,
  retrieveRecent,
  retrieveByTimeRange,
} from "./retrievalService";

export type { RetrievalParams, RetrievalResult } from "./retrievalService";

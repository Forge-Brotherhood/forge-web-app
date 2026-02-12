/**
 * Embedding Service
 *
 * Vector operations for semantic search on artifacts.
 * Uses OpenAI text-embedding-3-small with Bytes storage in Prisma.
 */

import { prisma } from "@/lib/prisma";
import type { ArtifactFilters, SearchResult } from "./types";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSION } from "./types";

// =============================================================================
// Types
// =============================================================================

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embedding for text using OpenAI API.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embedding error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;
  return data.data[0].embedding;
}

/**
 * Serialize float array to Buffer for storage.
 */
function serializeVector(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4); // 4 bytes per float32
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

/**
 * Deserialize Buffer/Uint8Array back to float array.
 * Prisma returns binary data as Uint8Array, so we handle both types.
 */
function deserializeVector(data: Buffer | Uint8Array): number[] {
  // Convert Uint8Array to Buffer if needed (Prisma returns Uint8Array for bytea)
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const vector: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    vector.push(buffer.readFloatLE(i));
  }
  return vector;
}

// =============================================================================
// Core Operations
// =============================================================================

/**
 * Embed an artifact asynchronously.
 * Creates or updates the embedding for the current model.
 */
export async function embedArtifact(artifactId: string): Promise<void> {
  // Fetch artifact content
  const artifact = await prisma.artifact.findUnique({
    where: { id: artifactId },
  });

  if (!artifact) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  if (artifact.status !== "active") {
    throw new Error("Cannot embed deleted artifact");
  }

  // Build text for embedding (title + content)
  const textParts: string[] = [];
  if (artifact.title) {
    textParts.push(artifact.title);
  }
  textParts.push(artifact.content);

  // Add scripture refs for context
  const scriptureRefs = artifact.scriptureRefs as string[] | null;
  if (scriptureRefs && scriptureRefs.length > 0) {
    textParts.push(`Scripture: ${scriptureRefs.join(", ")}`);
  }

  const text = textParts.join("\n");

  // Generate embedding
  const vector = await generateEmbedding(text);
  const vectorBuffer = serializeVector(vector);
  const vectorBytes = Uint8Array.from(vectorBuffer);

  // Upsert embedding
  await prisma.artifactEmbedding.upsert({
    where: {
      artifactId_model: {
        artifactId,
        model: EMBEDDING_MODEL,
      },
    },
    update: {
      vector: vectorBytes,
      dimension: vector.length,
    },
    create: {
      artifactId,
      model: EMBEDDING_MODEL,
      dimension: vector.length,
      vector: vectorBytes,
    },
  });
}

/**
 * Remove embedding for an artifact.
 */
export async function removeEmbedding(artifactId: string): Promise<void> {
  await prisma.artifactEmbedding.deleteMany({
    where: { artifactId },
  });
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search for similar artifacts using cosine similarity.
 * Returns top K results ordered by similarity score.
 */
export async function searchSimilar(
  query: string,
  filters: ArtifactFilters,
  topK: number = 20
): Promise<SearchResult[]> {
  // Generate query embedding
  const queryVector = await generateEmbedding(query);

  // Build filter conditions for artifacts
  const where: NonNullable<
    Parameters<typeof prisma.artifact.findMany>[0]
  >["where"] = {
    status: filters.status ?? "active",
  };

  if (filters.userId) {
    where.userId = filters.userId;
  }
  if (filters.types && filters.types.length > 0) {
    where.type = { in: filters.types };
  }
  if (filters.scopes && filters.scopes.length > 0) {
    where.scope = { in: filters.scopes };
  }
  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }

  // Fetch artifacts with embeddings
  const artifacts = await prisma.artifact.findMany({
    where,
    include: {
      embeddings: {
        where: { model: EMBEDDING_MODEL },
      },
    },
    take: 500, // Cap for performance
  });

  // Calculate similarities
  const results: SearchResult[] = [];

  for (const artifact of artifacts) {
    const embedding = artifact.embeddings[0];
    if (!embedding) {
      continue; // Skip artifacts without embeddings
    }

    const artifactVector = deserializeVector(embedding.vector);
    const similarity = cosineSimilarity(queryVector, artifactVector);

    results.push({
      artifact: {
        id: artifact.id,
        userId: artifact.userId,
        conversationId: artifact.conversationId,
        sessionId: artifact.sessionId,
        type: artifact.type as SearchResult["artifact"]["type"],
        scope: artifact.scope as SearchResult["artifact"]["scope"],
        title: artifact.title,
        content: artifact.content,
        scriptureRefs: artifact.scriptureRefs as string[] | null,
        tags: artifact.tags as string[] | null,
        metadata: artifact.metadata as Record<string, unknown> | null,
        status: artifact.status as SearchResult["artifact"]["status"],
        deletedAt: artifact.deletedAt,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
      },
      score: similarity,
    });
  }

  // Sort by similarity descending and take top K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Check if an artifact has an embedding.
 */
export async function hasEmbedding(artifactId: string): Promise<boolean> {
  const count = await prisma.artifactEmbedding.count({
    where: {
      artifactId,
      model: EMBEDDING_MODEL,
    },
  });
  return count > 0;
}

/**
 * Get embedding statistics for a user.
 */
export async function getEmbeddingStats(
  userId: string
): Promise<{ total: number; embedded: number }> {
  const [total, embedded] = await Promise.all([
    prisma.artifact.count({
      where: { userId, status: "active" },
    }),
    prisma.artifact.count({
      where: {
        userId,
        status: "active",
        embeddings: {
          some: { model: EMBEDDING_MODEL },
        },
      },
    }),
  ]);

  return { total, embedded };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

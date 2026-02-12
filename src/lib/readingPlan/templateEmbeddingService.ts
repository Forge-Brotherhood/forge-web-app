/**
 * Reading Plan Template Embedding Service
 *
 * Vector operations for semantic search on public reading plan templates.
 * Enables the Guide to find relevant plans based on user context and needs.
 */

import { prisma } from "@/lib/prisma";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSION } from "@/lib/artifacts/types";

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

export interface TemplateSearchResult {
  template: {
    id: string;
    shortId: string;
    slug: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    totalDays: number;
    estimatedMinutesMin: number;
    estimatedMinutesMax: number;
    theme: string | null;
    isFeatured: boolean;
  };
  score: number;
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
 */
function deserializeVector(data: Buffer | Uint8Array): number[] {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const vector: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    vector.push(buffer.readFloatLE(i));
  }
  return vector;
}

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

// =============================================================================
// Core Operations
// =============================================================================

/**
 * Build text content for embedding a template.
 * Combines title, subtitle, description, theme, and day summaries.
 */
async function buildTemplateEmbeddingText(templateId: string): Promise<string> {
  const template = await prisma.readingPlanTemplate.findUnique({
    where: { id: templateId },
    include: {
      days: {
        select: {
          title: true,
          summary: true,
          passageRef: true,
        },
        orderBy: { dayNumber: "asc" },
      },
    },
  });

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const textParts: string[] = [];

  // Title and subtitle
  textParts.push(template.title);
  if (template.subtitle) {
    textParts.push(template.subtitle);
  }

  // Description
  if (template.description) {
    textParts.push(template.description);
  }

  // Theme
  if (template.theme) {
    textParts.push(`Theme: ${template.theme}`);
  }

  // Duration info
  textParts.push(`${template.totalDays}-day reading plan`);

  // Scripture references from days
  const scriptureRefs = template.days
    .map((d) => d.passageRef)
    .filter(Boolean)
    .slice(0, 10); // Limit to first 10 for embedding
  if (scriptureRefs.length > 0) {
    textParts.push(`Scripture: ${scriptureRefs.join(", ")}`);
  }

  // Day titles for topical context
  const dayTitles = template.days
    .map((d) => d.title)
    .filter(Boolean)
    .slice(0, 10);
  if (dayTitles.length > 0) {
    textParts.push(`Topics: ${dayTitles.join(", ")}`);
  }

  return textParts.join("\n");
}

/**
 * Embed a reading plan template.
 * Creates or updates the embedding for the current model.
 * Only embeds public, published templates.
 */
export async function embedTemplate(templateId: string): Promise<void> {
  // Verify template exists and is public
  const template = await prisma.readingPlanTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      visibility: true,
      isPublished: true,
      deletedAt: true,
    },
  });

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  if (template.deletedAt) {
    throw new Error("Cannot embed deleted template");
  }

  // Only embed public published templates
  if (template.visibility !== "public" || !template.isPublished) {
    console.log(
      `[embedTemplate] Skipping non-public template ${templateId} (visibility: ${template.visibility}, published: ${template.isPublished})`
    );
    return;
  }

  // Build text and generate embedding
  const text = await buildTemplateEmbeddingText(templateId);
  const vector = await generateEmbedding(text);
  const vectorBuffer = serializeVector(vector);
  const vectorBytes = Uint8Array.from(vectorBuffer);

  // Upsert embedding
  await prisma.readingPlanTemplateEmbedding.upsert({
    where: {
      templateId_model: {
        templateId,
        model: EMBEDDING_MODEL,
      },
    },
    update: {
      vector: vectorBytes,
      dimension: vector.length,
    },
    create: {
      templateId,
      model: EMBEDDING_MODEL,
      dimension: vector.length,
      vector: vectorBytes,
    },
  });

  console.log(`[embedTemplate] Embedded template ${templateId}`);
}

/**
 * Remove embedding for a template.
 */
export async function removeTemplateEmbedding(templateId: string): Promise<void> {
  await prisma.readingPlanTemplateEmbedding.deleteMany({
    where: { templateId },
  });
}

/**
 * Embed all public published templates that don't have embeddings.
 * Useful for backfilling existing templates.
 */
export async function embedAllPublicTemplates(): Promise<{
  processed: number;
  embedded: number;
  errors: number;
}> {
  const templates = await prisma.readingPlanTemplate.findMany({
    where: {
      visibility: "public",
      isPublished: true,
      deletedAt: null,
      embeddings: {
        none: { model: EMBEDDING_MODEL },
      },
    },
    select: { id: true },
  });

  let embedded = 0;
  let errors = 0;

  for (const template of templates) {
    try {
      await embedTemplate(template.id);
      embedded++;
    } catch (error) {
      console.error(`[embedAllPublicTemplates] Error embedding ${template.id}:`, error);
      errors++;
    }
  }

  return {
    processed: templates.length,
    embedded,
    errors,
  };
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search for similar templates using cosine similarity.
 * Only searches public, published templates.
 */
export async function searchTemplates(
  query: string,
  topK: number = 5
): Promise<TemplateSearchResult[]> {
  // Generate query embedding
  const queryVector = await generateEmbedding(query);

  // Fetch public published templates with embeddings
  const templates = await prisma.readingPlanTemplate.findMany({
    where: {
      visibility: "public",
      isPublished: true,
      deletedAt: null,
      embeddings: {
        some: { model: EMBEDDING_MODEL },
      },
    },
    include: {
      embeddings: {
        where: { model: EMBEDDING_MODEL },
      },
    },
    take: 200, // Cap for performance
  });

  // Calculate similarities
  const results: TemplateSearchResult[] = [];

  for (const template of templates) {
    const embedding = template.embeddings[0];
    if (!embedding) {
      continue;
    }

    const templateVector = deserializeVector(embedding.vector);
    const similarity = cosineSimilarity(queryVector, templateVector);

    results.push({
      template: {
        id: template.id,
        shortId: template.shortId,
        slug: template.slug,
        title: template.title,
        subtitle: template.subtitle,
        description: template.description,
        totalDays: template.totalDays,
        estimatedMinutesMin: template.estimatedMinutesMin,
        estimatedMinutesMax: template.estimatedMinutesMax,
        theme: template.theme,
        isFeatured: template.isFeatured,
      },
      score: similarity,
    });
  }

  // Sort by similarity descending and take top K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Check if a template has an embedding.
 */
export async function hasTemplateEmbedding(templateId: string): Promise<boolean> {
  const count = await prisma.readingPlanTemplateEmbedding.count({
    where: {
      templateId,
      model: EMBEDDING_MODEL,
    },
  });
  return count > 0;
}

/**
 * Get embedding statistics for templates.
 */
export async function getTemplateEmbeddingStats(): Promise<{
  totalPublic: number;
  embedded: number;
}> {
  const [totalPublic, embedded] = await Promise.all([
    prisma.readingPlanTemplate.count({
      where: {
        visibility: "public",
        isPublished: true,
        deletedAt: null,
      },
    }),
    prisma.readingPlanTemplate.count({
      where: {
        visibility: "public",
        isPublished: true,
        deletedAt: null,
        embeddings: {
          some: { model: EMBEDDING_MODEL },
        },
      },
    }),
  ]);

  return { totalPublic, embedded };
}

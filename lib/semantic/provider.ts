// Week 8 — Embedding provider abstraction.
//
//   text(s) -> provider -> number[384] per text (L2-normalised)
//
// Providers:
//   local  (REAL, default)  open model running on this machine (no key, no cost)
//   openai (REAL, optional) text-embedding-3-small, only when selected + keyed
//   test   (TEST ONLY)      deterministic fake vectors for automated tests
//
// Every vector is validated (count, dimension, finite numbers) before it can
// reach PostgreSQL, so a misbehaving provider can never corrupt the index.
import {
  embeddingModelId,
  getEmbeddingConfig,
  type EmbeddingConfig,
} from "@/lib/semantic/config";

export interface EmbeddingProvider {
  readonly config: EmbeddingConfig;
  // value stored in semantic_documents.embedding_model
  readonly modelId: string;
  // Content to index (Pages, Posts, Comments, File Chunks).
  embedDocuments(texts: string[]): Promise<number[][]>;
  // A user's search query.
  embedQuery(text: string): Promise<number[]>;
}

// Timeout, rate limit, network problem, model download hiccup: retry later.
export class TransientEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientEmbeddingError";
  }
}

// Wrong dimensions, invalid response, bad credentials/config: retrying the
// same request cannot help.
export class PermanentEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmbeddingError";
  }
}

export function validateVectors(
  vectors: unknown,
  expectedCount: number,
  dimensions: number
): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new PermanentEmbeddingError("Embedding provider returned an invalid response.");
  }

  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      throw new PermanentEmbeddingError(
        `Embedding provider returned vectors with the wrong dimension (expected ${dimensions}).`
      );
    }

    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new PermanentEmbeddingError("Embedding provider returned an invalid vector.");
      }
    }
  }

  return vectors as number[][];
}

// Sends texts in batches (one request / model call per batch, not per row).
export async function embedInBatches(
  texts: string[],
  batchSize: number,
  embedBatch: (batch: string[]) => Promise<number[][]>
) {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    vectors.push(...(await embedBatch(batch)));
  }

  return vectors;
}

// pgvector text format: [0.1,0.2,...]  (sent as a bind parameter, cast ::vector)
export function toVectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}

export async function createEmbeddingProvider(
  config: EmbeddingConfig = getEmbeddingConfig()
): Promise<EmbeddingProvider> {
  const modelId = embeddingModelId(config);

  switch (config.provider) {
    case "local": {
      const { createLocalProvider } = await import("@/lib/semantic/providers/local");
      return createLocalProvider(config, modelId);
    }
    case "openai": {
      const { createOpenAIProvider } = await import("@/lib/semantic/providers/openai");
      return createOpenAIProvider(config, modelId);
    }
    case "test": {
      const { createTestOnlyProvider } = await import("@/lib/semantic/providers/test-only");
      return createTestOnlyProvider(config, modelId);
    }
  }
}

// Week 8 — central Embedding / Semantic indexing configuration.
//
// Plain Node module (no "server-only") so the Next.js app, the standalone
// Worker and the reindex command all read EXACTLY the same settings.
// It never reads or returns secrets: provider credentials are read only by
// the provider module that needs them, on the server.
import type { DefaultJobOptions } from "bullmq";

// ONE fixed vector size for the whole index. It MUST equal vector(384) in
// database/migrations/007_add_semantic_index.sql. A provider that returns any
// other length is rejected before anything is written.
export const EMBEDDING_DIMENSIONS = 384;

export const EMBEDDING_PROVIDERS = ["local", "openai", "test"] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

// Default REAL provider: a local open model (no API key, no cost).
// intfloat/multilingual-e5-small (MIT) as ONNX, Arabic + English, 384 dims.
export const DEFAULT_LOCAL_MODEL = "Xenova/multilingual-e5-small";
// Pinned Hugging Face revision of the default model (reproducible downloads).
export const DEFAULT_LOCAL_MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
// Optional REAL provider, only active when selected AND a key is configured.
export const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
// TEST ONLY deterministic provider (automated tests). Not configurable.
export const TEST_ONLY_MODEL = "nozomkb-test-only-hash-v1";

export type EmbeddingConfig = {
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  // true ONLY for the deterministic test provider
  testOnly: boolean;
};

export class EmbeddingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigError";
  }
}

// EMBEDDING_PROVIDER = local (default) | openai | test
// EMBEDDING_MODEL    = optional model override (local / openai)
// EMBEDDING_DIMENSIONS = optional, must be 384 (the schema dimension)
export function getEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = (env.EMBEDDING_PROVIDER || "local").trim().toLowerCase();

  if (!EMBEDDING_PROVIDERS.includes(provider as EmbeddingProviderName)) {
    throw new EmbeddingConfigError(`Unknown EMBEDDING_PROVIDER "${provider}".`);
  }

  const dimensionsText = env.EMBEDDING_DIMENSIONS?.trim();

  if (dimensionsText && Number(dimensionsText) !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingConfigError(
      `EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} (the pgvector column is vector(${EMBEDDING_DIMENSIONS})).`
    );
  }

  if (provider === "test") {
    // Two explicit switches: the fake provider can never be picked up by a
    // normal installation by accident.
    if (env.NOZOMKB_TEST_EMBEDDINGS !== "1") {
      throw new EmbeddingConfigError(
        "The TEST ONLY embedding provider requires NOZOMKB_TEST_EMBEDDINGS=1 (automated tests only)."
      );
    }

    return {
      provider: "test",
      model: TEST_ONLY_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      testOnly: true,
    };
  }

  const model =
    env.EMBEDDING_MODEL?.trim() ||
    (provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_LOCAL_MODEL);

  return {
    provider: provider as EmbeddingProviderName,
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    testOnly: false,
  };
}

// Stored in semantic_documents.embedding_model. Vectors are only ever
// compared with vectors of the same provider + model + dimension.
export function embeddingModelId(config: EmbeddingConfig) {
  return `${config.testOnly ? "test-only" : config.provider}:${config.model}@${config.dimensions}`;
}

// ---------------------------------------------------------------
// Queue (BullMQ / Redis) — separate from the Week 7 File processing Queue.
// ---------------------------------------------------------------
export const SEMANTIC_QUEUE_NAME = "nozom-semantic-indexing";
// Test runs use their own Queue so a TEST ONLY worker never picks up real
// indexing Jobs (and vice versa).
export const SEMANTIC_TEST_QUEUE_NAME = "nozom-semantic-indexing-test";
export const INDEX_SOURCE_JOB = "index-source";

export function semanticQueueName(config: EmbeddingConfig) {
  return config.testOnly ? SEMANTIC_TEST_QUEUE_NAME : SEMANTIC_QUEUE_NAME;
}

export const SEMANTIC_JOB_ATTEMPTS = 4;

export const SEMANTIC_JOB_OPTIONS: DefaultJobOptions = {
  // 1 try + 3 automatic retries (2 s, 4 s, 8 s) for timeouts / rate limits.
  attempts: SEMANTIC_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
};

// page / post / comment = one embedding; file = all Chunks of one version.
export const SEMANTIC_SOURCE_KINDS = ["page", "post", "comment", "file"] as const;
export type SemanticSourceKind = (typeof SEMANTIC_SOURCE_KINDS)[number];

// Only identifiers travel through Redis — the text is read from PostgreSQL.
export type SemanticJobData = {
  sourceType: SemanticSourceKind;
  sourceId: number;
  sourceVersion: number;
};

export function semanticJobId(job: SemanticJobData) {
  return `${job.sourceType}-${job.sourceId}-v${job.sourceVersion}`;
}

export function parseSemanticJobData(data: unknown): SemanticJobData {
  const { sourceType, sourceId, sourceVersion } = (data ?? {}) as Record<string, unknown>;

  if (
    !SEMANTIC_SOURCE_KINDS.includes(sourceType as SemanticSourceKind) ||
    !Number.isSafeInteger(sourceId) ||
    !Number.isSafeInteger(sourceVersion) ||
    (sourceId as number) < 1 ||
    (sourceVersion as number) < 1
  ) {
    throw new Error("Invalid semantic indexing job data.");
  }

  return {
    sourceType: sourceType as SemanticSourceKind,
    sourceId: sourceId as number,
    sourceVersion: sourceVersion as number,
  };
}

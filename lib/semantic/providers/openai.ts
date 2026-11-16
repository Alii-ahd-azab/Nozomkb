// REAL embedding provider #2 (optional): OpenAI text-embedding-3-small.
//
// Active ONLY when EMBEDDING_PROVIDER=openai AND OPENAI_API_KEY is set
// (server-side env, never NEXT_PUBLIC_). The model supports shortened
// vectors, so `dimensions: 384` keeps it compatible with the same
// vector(384) column. Only the texts are sent — no user, permission or
// file metadata. The key is never logged or returned.
import type { EmbeddingConfig } from "@/lib/semantic/config";
import {
  PermanentEmbeddingError,
  TransientEmbeddingError,
  embedInBatches,
  validateVectors,
  type EmbeddingProvider,
} from "@/lib/semantic/provider";

const ENDPOINT = "https://api.openai.com/v1/embeddings";
// Well below the provider's per-request input limits.
const BATCH_SIZE = 64;
const TIMEOUT_MS = 20000;
// ~8k tokens max per input; cut very long texts conservatively.
const MAX_INPUT_CHARS = 16000;

type EmbeddingsResponse = {
  data?: { index?: number; embedding?: unknown }[];
};

export function createOpenAIProvider(
  config: EmbeddingConfig,
  modelId: string
): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new PermanentEmbeddingError(
      "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not configured on the server."
    );
  }

  async function embedBatch(batch: string[]) {
    let response: Response;

    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: batch.map((text) => text.slice(0, MAX_INPUT_CHARS)),
          dimensions: config.dimensions,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // timeout / DNS / connection reset
      throw new TransientEmbeddingError("Embedding provider could not be reached (network/timeout).");
    }

    if (response.status === 429 || response.status >= 500) {
      throw new TransientEmbeddingError(`Embedding provider is busy (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      // 400/401/403/404: configuration or request problem. Body not logged.
      throw new PermanentEmbeddingError(`Embedding provider rejected the request (HTTP ${response.status}).`);
    }

    let body: EmbeddingsResponse;

    try {
      body = (await response.json()) as EmbeddingsResponse;
    } catch {
      throw new PermanentEmbeddingError("Embedding provider returned an invalid response.");
    }

    const rows = Array.isArray(body.data) ? [...body.data] : [];
    rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return validateVectors(
      rows.map((row) => row.embedding),
      batch.length,
      config.dimensions
    );
  }

  return {
    config,
    modelId,
    embedDocuments: (texts) => embedInBatches(texts, BATCH_SIZE, embedBatch),
    embedQuery: async (text) => (await embedBatch([text]))[0],
  };
}

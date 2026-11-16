// REAL embedding provider #1 (default): a local open model, run on this
// machine with @huggingface/transformers (ONNX Runtime, CPU).
//
// Model: intfloat/multilingual-e5-small (MIT licence), ONNX export
// "Xenova/multilingual-e5-small", 8-bit quantised (~113 MB), 384 dimensions,
// Arabic + English. Downloaded once into .models/ (git-ignored); after that
// it works offline. No API key, no cost, no text leaves the machine.
//
// E5 models expect "query: " for searches and "passage: " for content.
import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_MODEL_REVISION,
  type EmbeddingConfig,
} from "@/lib/semantic/config";
import {
  TransientEmbeddingError,
  embedInBatches,
  validateVectors,
  type EmbeddingProvider,
} from "@/lib/semantic/provider";

const BATCH_SIZE = 16;

// One loaded model per process (also survives Next.js dev hot reloads).
const globalForModel = globalThis as unknown as {
  nozomLocalEmbedder?: Map<string, Promise<FeatureExtractionPipeline>>;
};

function modelCacheDir() {
  return path.resolve(
    process.env.EMBEDDING_CACHE_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), ".models")
  );
}

function loadExtractor(model: string) {
  globalForModel.nozomLocalEmbedder ??= new Map();
  const cache = globalForModel.nozomLocalEmbedder;
  let loading = cache.get(model);

  if (!loading) {
    loading = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = modelCacheDir();

      return pipeline("feature-extraction", model, {
        dtype: "q8",
        revision:
          model === DEFAULT_LOCAL_MODEL
            ? DEFAULT_LOCAL_MODEL_REVISION
            : process.env.EMBEDDING_MODEL_REVISION || "main",
      });
    })();

    // A failed load (e.g. no network for the first download) is retried later.
    loading.catch(() => cache.delete(model));
    cache.set(model, loading);
  }

  return loading;
}

export function createLocalProvider(
  config: EmbeddingConfig,
  modelId: string
): EmbeddingProvider {
  const isE5 = /e5/i.test(config.model);

  async function embed(texts: string[], prefix: string) {
    let extractor: FeatureExtractionPipeline;

    try {
      extractor = await loadExtractor(config.model);
    } catch (error) {
      throw new TransientEmbeddingError(
        `Local embedding model could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    return embedInBatches(texts, BATCH_SIZE, async (batch) => {
      const output = await extractor(
        batch.map((text) => (isE5 ? `${prefix}${text}` : text)),
        { pooling: "mean", normalize: true }
      );

      return validateVectors(output.tolist(), batch.length, config.dimensions);
    });
  }

  return {
    config,
    modelId,
    embedDocuments: (texts) => embed(texts, "passage: "),
    embedQuery: async (text) => (await embed([text], "query: "))[0],
  };
}

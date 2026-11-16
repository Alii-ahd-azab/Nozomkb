// ================================================================
//  TEST ONLY — deterministic FAKE embeddings for automated tests.
//  These vectors are NOT real semantic embeddings and say NOTHING about
//  real retrieval quality. Selected only with EMBEDDING_PROVIDER=test AND
//  NOZOMKB_TEST_EMBEDDINGS=1 (see lib/semantic/config.ts).
// ================================================================
//
// How it works: words are lower-cased, stop words dropped, and a small,
// hand-written synonym table maps related words to one concept
// ("vacation", "holiday", "leave" -> leave). Each concept/word is hashed
// into one of 384 dimensions (feature hashing) and the vector is
// L2-normalised. Same text -> same vector, always. Texts sharing concepts
// (even with different words) get a high cosine similarity, which is
// enough to test the architecture with controlled fixtures — no money,
// no network, no model download.
//
// Fault injection (tests only), triggered by markers inside the text:
//   [[test:fail-once:<token>]]  first call in this process throws a
//                               transient error, the retry succeeds
//   [[test:fail-always]]        every call throws a transient error
//   [[test:wrong-dimensions]]   returns 383 numbers (permanent failure)
import type { EmbeddingConfig } from "@/lib/semantic/config";
import {
  TransientEmbeddingError,
  validateVectors,
  type EmbeddingProvider,
} from "@/lib/semantic/provider";

const CONCEPTS: Record<string, string> = {};

function group(concept: string, words: string[]) {
  for (const word of words) CONCEPTS[word] = concept;
}

group("leave", ["leave", "vacation", "holiday", "holidays", "pto", "absence", "dayoff", "إجازة", "اجازة"]);
group("pay", ["salary", "payroll", "pay", "paycheck", "wage", "wages", "compensation", "راتب"]);
group("computer", ["laptop", "computer", "notebook", "pc", "workstation", "device"]);
group("password", ["password", "passcode", "credentials", "login", "signin"]);
group("remote", ["vpn", "remote", "remotely", "home", "telework"]);
group("printer", ["printer", "printing", "print", "toner", "cartridge"]);
group("onboarding", ["onboarding", "orientation", "newcomer", "hire", "hires", "joiner", "joiners"]);
group("expense", ["expense", "expenses", "reimbursement", "reimburse", "receipt", "receipts", "claim"]);
group("broken", ["broken", "faulty", "damaged", "crashed", "crash", "fails", "failure"]);
group("travel", ["travel", "trip", "flight", "hotel", "business-trip"]);

const STOP_WORDS = new Set(
  ("a an the and or of to in on for with at by from is are was were be been it this that these those " +
    "how what when where which who why do does did can could should would i we you our your my me " +
    "get got have has had about into than then there their they them its as if not no yes per any all " +
    "test w8").split(" ")
);

const failedOnce = new Set<string>();

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function features(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];

  for (const raw of words) {
    if (STOP_WORDS.has(raw) || raw.length < 2) continue;
    const singular = raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw;
    const concept = CONCEPTS[raw] ?? CONCEPTS[singular];
    out.push(concept ? `concept:${concept}` : `word:${singular}`);
  }

  return out;
}

function fakeVector(text: string, dimensions: number) {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = features(text);

  for (const token of tokens) {
    const hash = fnv1a(token);
    // concepts weigh more than unrelated words
    const weight = token.startsWith("concept:") ? 3 : 1;
    vector[hash % dimensions] += (hash & 0x10000 ? 1 : -1) * weight;
  }

  let norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (norm === 0) {
    vector[0] = 1; // empty text: fixed unit vector (never a zero vector)
    norm = 1;
  }

  return vector.map((value) => value / norm);
}

function injectFaults(texts: string[]) {
  for (const text of texts) {
    if (text.includes("[[test:fail-always]]")) {
      throw new TransientEmbeddingError("TEST ONLY: simulated provider outage.");
    }

    const once = text.match(/\[\[test:fail-once:([\w-]+)\]\]/);
    if (once && !failedOnce.has(once[1])) {
      failedOnce.add(once[1]);
      throw new TransientEmbeddingError("TEST ONLY: simulated provider timeout.");
    }
  }
}

export function createTestOnlyProvider(
  config: EmbeddingConfig,
  modelId: string
): EmbeddingProvider {
  async function embed(texts: string[]) {
    injectFaults(texts);

    const vectors = texts.map((text) =>
      text.includes("[[test:wrong-dimensions]]")
        ? fakeVector(text, config.dimensions - 1)
        : fakeVector(text, config.dimensions)
    );

    return validateVectors(vectors, texts.length, config.dimensions);
  }

  return {
    config,
    modelId,
    embedDocuments: embed,
    embedQuery: async (text) => (await embed([text]))[0],
  };
}

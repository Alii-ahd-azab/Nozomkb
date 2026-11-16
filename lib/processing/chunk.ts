// Week 7 — deterministic Chunking.
//
// Strategy: ~1200 characters per Chunk with ~150 characters of overlap.
// - 1200 chars ≈ 200–300 words: small enough that a keyword hit points to a
//   precise place (and fits a Week 8 embedding comfortably), large enough to
//   keep a paragraph's context together.
// - 150 chars of overlap means a sentence cut at a boundary is still found in
//   one piece in the next Chunk.
// - Cuts prefer a paragraph break, then a line break, then a sentence end,
//   then a space — never mid-word unless a "word" is longer than 600 chars.
// - Chunks never cross PDF pages, so page_number is always exact.
// Same input -> same Chunks, always (no randomness, no clocks).
import type { ExtractedPage } from "@/lib/processing/extract";

export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;
// Do not search for a "nice" cut earlier than this inside a Chunk.
const MIN_CHUNK_BEFORE_BREAK = 600;

export type TextChunk = {
  pageNumber: number;
  // 0-based position across the whole File version
  chunkIndex: number;
  text: string;
};

const BREAKS: RegExp[] = [/\n\n/g, /\n/g, /[.!?؟。][ \n]/g, / /g];

// End position (exclusive) of the best break between min and max.
function findBreak(text: string, min: number, max: number) {
  const window = text.slice(min, max);

  for (const pattern of BREAKS) {
    let last = -1;
    let length = 0;

    for (const match of window.matchAll(pattern)) {
      last = match.index ?? -1;
      length = match[0].length;
    }

    if (last >= 0) {
      return min + last + length;
    }
  }

  // No whitespace at all: hard cut, but never between a surrogate pair.
  const code = text.charCodeAt(max - 1);
  return code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
}

export function splitText(text: string): string[] {
  const pieces: string[] = [];
  const length = text.length;
  let start = 0;

  while (start < length) {
    let end = Math.min(start + CHUNK_SIZE, length);

    if (end < length) {
      end = findBreak(text, start + MIN_CHUNK_BEFORE_BREAK, end);
    }

    const piece = text.slice(start, end).trim();

    if (piece) {
      pieces.push(piece);
    }

    if (end >= length) {
      break;
    }

    // Start the next Chunk CHUNK_OVERLAP characters back, at a word start.
    let next = Math.max(end - CHUNK_OVERLAP, start + 1);
    const space = text.slice(next, end).search(/\s/);

    if (space >= 0) {
      next += space + 1;
    }

    start = next;
  }

  return pieces;
}

export function chunkPages(pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];

  for (const page of pages) {
    for (const text of splitText(page.text)) {
      chunks.push({ pageNumber: page.pageNumber, chunkIndex: chunks.length, text });
    }
  }

  return chunks;
}

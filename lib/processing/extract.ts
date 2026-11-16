// Week 7 — text extraction (Worker only). NO OCR: an image-only / scanned
// PDF simply has no text layer and is reported as not indexable.
import { AR } from "@/lib/messages";

export type ExtractedPage = {
  // 1-based. A TXT file is one logical page (page 1).
  pageNumber: number;
  text: string;
};

// A permanent, user-explainable problem with the File itself (empty text,
// scanned PDF, unreadable PDF). Retrying cannot fix it.
export class NotIndexableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotIndexableError";
  }
}

// Deterministic cleanup so the same bytes always give the same text:
// CRLF/CR -> LF, control characters and runs of spaces collapsed,
// at most one blank line between paragraphs.
export function normalizeText(text: string) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// UTF-8 first (strict). Older Arabic Windows text files are often
// windows-1256, so that is the fallback instead of producing "�" garbage.
function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

function extractTxt(bytes: Uint8Array): ExtractedPage[] {
  const text = normalizeText(decodeText(bytes));

  if (!text) {
    throw new NotIndexableError(AR.processingEmptyText);
  }

  return [{ pageNumber: 1, text }];
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  // unpdf ships a Node-friendly PDF.js build (ESM-only, loaded lazily).
  const { extractText } = await import("unpdf");

  let pageTexts: string[];

  try {
    // One string per page. PDF.js may detach the buffer it is given, so
    // pass a copy.
    pageTexts = (await extractText(new Uint8Array(bytes), { mergePages: false })).text;
  } catch {
    // corrupt, truncated or password-protected PDF
    throw new NotIndexableError(AR.processingPdfUnreadable);
  }

  // Page numbers come from the PDF itself; pages without a text layer are
  // skipped but never renumber the pages after them.
  const pages = pageTexts
    .map((text, index) => ({ pageNumber: index + 1, text: normalizeText(text) }))
    .filter((page) => page.text.length > 0);

  if (pages.length === 0) {
    throw new NotIndexableError(AR.processingNoPdfText);
  }

  return pages;
}

export async function extractPages(
  bytes: Uint8Array,
  mimeType: string
): Promise<ExtractedPage[]> {
  if (mimeType === "application/pdf") {
    return extractPdf(bytes);
  }

  if (mimeType === "text/plain") {
    return extractTxt(bytes);
  }

  throw new NotIndexableError(AR.fileUnsupported);
}

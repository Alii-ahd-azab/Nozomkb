// File metadata (PostgreSQL) + upload validation.
// Callers authorize via lib/authz.ts (parent access) BEFORE using these.
import "server-only";

import pool from "@/lib/db";
import { parentColumn } from "@/lib/content-parent";
import {
  MAX_FILE_SIZE_BYTES,
  type FileItem,
  type FileProcessingStatus,
  type ParentKind,
} from "@/lib/definitions";
import { AR } from "@/lib/messages";

// ---------------------------------------------------------------
// Validation (never trusts the browser's name, MIME type or size)
// ---------------------------------------------------------------

const ALLOWED = {
  pdf: { mimeTypes: ["application/pdf"], storedMime: "application/pdf" },
  txt: { mimeTypes: ["text/plain"], storedMime: "text/plain" },
} as const;

type ValidatedUpload =
  | {
      ok: true;
      extension: "pdf" | "txt";
      mimeType: string;
      originalName: string;
      bytes: Uint8Array;
    }
  | { ok: false; status: 400 | 413 | 415; error: string };

// Keep only the last path segment and strip control characters, so names
// like "../../x.txt" or "C:\\x.txt" are stored as plain display names.
export function sanitizeOriginalName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  return cleaned.slice(-255);
}

function looksLikeText(bytes: Uint8Array) {
  // A NUL byte is a reliable sign of binary content.
  return !bytes.includes(0);
}

function startsWithPdfSignature(bytes: Uint8Array) {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

  return signature.every((byte, index) => bytes[index] === byte);
}

export async function validateUpload(file: File): Promise<ValidatedUpload> {
  const originalName = sanitizeOriginalName(file.name);
  const extensionMatch = /\.([a-z0-9]+)$/i.exec(originalName);
  const extension = extensionMatch?.[1].toLowerCase();

  if (!originalName || (extension !== "pdf" && extension !== "txt")) {
    return { ok: false, status: 415, error: AR.fileUnsupported };
  }

  const rule = ALLOWED[extension];
  const browserMime = file.type.split(";")[0].trim().toLowerCase();

  if (!(rule.mimeTypes as readonly string[]).includes(browserMime)) {
    return { ok: false, status: 415, error: AR.fileUnsupported };
  }

  // Cheap early check, then the REAL byte count below.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, status: 413, error: AR.fileTooLarge };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: AR.fileEmpty };
  }

  if (bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    return { ok: false, status: 413, error: AR.fileTooLarge };
  }

  const contentMatches =
    extension === "pdf" ? startsWithPdfSignature(bytes) : looksLikeText(bytes);

  if (!contentMatches) {
    return { ok: false, status: 415, error: AR.fileContentMismatch };
  }

  return {
    ok: true,
    extension,
    // Stored type comes from the server's decision, not the browser.
    mimeType: rule.storedMime,
    originalName,
    bytes,
  };
}

// ---------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------

export type FileRecord = FileItem & {
  storageKey: string;
  parentKind: ParentKind;
  parentId: number;
};

type FileRow = {
  id: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: string;
  uploader_name: string | null;
  post_id: string | null;
  page_id: string | null;
  created_at: Date;
  version: number;
  processing_status: FileProcessingStatus;
  processing_error: string | null;
  is_active: boolean;
  processed_at: Date | null;
};

const FILE_SELECT = `
  SELECT
    files.id,
    files.original_name,
    files.storage_key,
    files.mime_type,
    files.size_bytes,
    users.name AS uploader_name,
    files.post_id,
    files.page_id,
    files.created_at,
    files.version,
    files.processing_status,
    files.processing_error,
    files.is_active,
    files.processed_at
  FROM files
  LEFT JOIN users ON users.id = files.uploaded_by
`;

function toFile(row: FileRow): FileRecord {
  return {
    id: Number(row.id),
    originalName: row.original_name,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploaderName: row.uploader_name,
    parentKind: row.post_id !== null ? "post" : "page",
    parentId: Number(row.post_id ?? row.page_id),
    createdAt: row.created_at.toISOString(),
    version: row.version,
    status: row.processing_status,
    error: row.processing_error,
    isActive: row.is_active,
    processedAt: row.processed_at ? row.processed_at.toISOString() : null,
  };
}

// Public shape for the browser: never includes the storage key.
export function toFileItem(file: FileRecord): FileItem {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploaderName: file.uploaderName,
    createdAt: file.createdAt,
    version: file.version,
    status: file.status,
    error: file.error,
    isActive: file.isActive,
    processedAt: file.processedAt,
  };
}

export async function listFiles(kind: ParentKind, parentId: number) {
  const result = await pool.query<FileRow>(
    `
      ${FILE_SELECT}
      WHERE files.${parentColumn(kind)} = $1
      ORDER BY files.created_at DESC, files.id DESC
    `,
    [parentId]
  );

  return result.rows.map(toFile);
}

// Raw lookup — the caller MUST check the parent's access afterwards.
export async function getFileById(id: number) {
  const result = await pool.query<FileRow>(
    `${FILE_SELECT} WHERE files.id = $1`,
    [id]
  );

  return result.rows[0] ? toFile(result.rows[0]) : null;
}

export async function insertFileMetadata(input: {
  kind: ParentKind;
  parentId: number;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number;
}) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO files (
        original_name, storage_key, mime_type, size_bytes, uploaded_by,
        ${parentColumn(input.kind)}
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      input.originalName,
      input.storageKey,
      input.mimeType,
      input.sizeBytes,
      input.uploadedBy,
      input.parentId,
    ]
  );

  return getFileById(Number(result.rows[0].id));
}

export async function deleteFileMetadata(id: number) {
  const result = await pool.query<{ storage_key: string }>(
    `DELETE FROM files WHERE id = $1 RETURNING storage_key`,
    [id]
  );

  return result.rows[0]?.storage_key ?? null;
}

// Used before deleting a parent: the DB rows cascade, the disk files do not.
export async function getStorageKeysForParent(
  kind: ParentKind,
  parentId: number
) {
  const result = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM files WHERE ${parentColumn(kind)} = $1`,
    [parentId]
  );

  return result.rows.map((row) => row.storage_key);
}

// ---------------------------------------------------------------
// Week 7: processing state, retry, enable/disable, replace (versions)
// Every write is guarded by the expected version, so an old request or Job
// can never change a newer File version.
// ---------------------------------------------------------------

// The Queue could not take the Job (Redis down): keep the File, make the
// problem visible and retryable.
export async function markQueueUnavailable(id: number, version: number, message: string) {
  await pool.query(
    `
      UPDATE files
      SET processing_status = 'failed', processing_error = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND version = $2 AND processing_status IN ('pending', 'processing')
    `,
    [id, version, message]
  );
}

// Failed -> Pending (only an active File, only the current version).
export async function resetFailedFile(id: number, version: number) {
  const result = await pool.query(
    `
      UPDATE files
      SET processing_status = 'pending', processing_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND version = $2 AND is_active
        AND processing_status = 'failed'
    `,
    [id, version]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function setFileActive(id: number, isActive: boolean) {
  await pool.query(
    `UPDATE files SET is_active = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, isActive]
  );

  return getFileById(id);
}

// New content for an existing File: new private disk file, version + 1,
// back to Pending, and the old version's Chunks are removed in the SAME
// transaction (Search already ignores them: it only reads the current version).
export async function replaceFileContent(input: {
  id: number;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number;
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const locked = await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM files WHERE id = $1 FOR UPDATE",
      [input.id]
    );

    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const updated = await client.query<{ version: number }>(
      `
        UPDATE files
        SET original_name = $2, storage_key = $3, mime_type = $4,
            size_bytes = $5, uploaded_by = $6,
            version = version + 1,
            processing_status = 'pending', processing_error = NULL,
            processed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING version
      `,
      [
        input.id,
        input.originalName,
        input.storageKey,
        input.mimeType,
        input.sizeBytes,
        input.uploadedBy,
      ]
    );

    await client.query("DELETE FROM file_chunks WHERE file_id = $1", [input.id]);
    await client.query("COMMIT");

    return {
      oldStorageKey: locked.rows[0].storage_key,
      newVersion: updated.rows[0].version,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

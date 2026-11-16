"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALLOWED_FILE_EXTENSIONS,
  FILE_STATUS_LABELS,
  MAX_FILE_SIZE_BYTES,
  type FileItem,
  type ParentKind,
} from "@/lib/definitions";
import { AR } from "@/lib/messages";

type FilesSectionProps = {
  kind: ParentKind;
  parentId: number;
  initialFiles: FileItem[];
  // computed on the server; the upload/manage APIs check again
  canManage: boolean;
};

const POLL_INTERVAL_MS = 2500;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Same quick browser-side checks as Week 6 (the server re-validates).
function checkSelectedFile(file: File | undefined) {
  if (!file) return AR.fileMissing;

  const lowerName = file.name.toLowerCase();

  if (!ALLOWED_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return AR.fileUnsupported;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) return AR.fileTooLarge;

  return "";
}

function isUnfinished(file: FileItem) {
  return file.isActive && (file.status === "pending" || file.status === "processing");
}

export default function FilesSection({
  kind,
  parentId,
  initialFiles,
  canManage,
}: FilesSectionProps) {
  const [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const listUrl = `/api/${kind === "post" ? "posts" : "pages"}/${parentId}/files`;
  const hasUnfinished = files.some(isUnfinished);

  // Week 7: processing happens in the background Worker, so refresh the list
  // while any File is still Pending / Processing.
  useEffect(() => {
    if (!hasUnfinished) return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(listUrl, { cache: "no-store" });
        if (response.ok) setFiles((await response.json()) as FileItem[]);
      } catch {
        // ignore; next tick tries again
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hasUnfinished, listUrl]);

  function replaceInList(updated: FileItem) {
    setFiles((previous) =>
      previous.map((file) => (file.id === updated.id ? updated : file))
    );
  }

  // Runs one request; returns the parsed JSON body or null after showing the error.
  async function send(url: string, init: RequestInit, fallbackError: string) {
    setIsBusy(true);
    setError("");

    try {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || fallbackError);
        return null;
      }

      return data;
    } catch {
      setError(fallbackError);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    const problem = checkSelectedFile(file);

    if (problem || !file) return setError(problem || AR.fileMissing);

    const formData = new FormData();
    formData.append("file", file);

    const created = await send(listUrl, { method: "POST", body: formData }, AR.uploadFailed);

    if (created) {
      setFiles((previous) => [created as FileItem, ...previous]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleReplace(event: React.FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    const file = replaceRef.current?.files?.[0];
    const problem = checkSelectedFile(file);

    if (problem || !file) return setError(problem || AR.fileMissing);

    const formData = new FormData();
    formData.append("file", file);

    const updated = await send(
      `/api/files/${id}/replace`,
      { method: "POST", body: formData },
      AR.fileUpdateFailed
    );

    if (updated) {
      replaceInList(updated as FileItem);
      setReplacingId(null);
    }
  }

  async function handleRetry(id: number) {
    const updated = await send(`/api/files/${id}/retry`, { method: "POST" }, AR.fileRetryFailed);
    if (updated) replaceInList(updated as FileItem);
  }

  async function handleToggle(file: FileItem) {
    const updated = await send(
      `/api/files/${file.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !file.isActive }),
      },
      AR.fileUpdateFailed
    );
    if (updated) replaceInList(updated as FileItem);
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this file?")) return;

    if (await send(`/api/files/${id}`, { method: "DELETE" }, AR.fileDeleteFailed)) {
      setFiles((previous) => previous.filter((file) => file.id !== id));
    }
  }

  return (
    <section className="detail-section" aria-labelledby="files-heading">
      <h2 id="files-heading">
        Files <span className="count-pill">{files.length}</span>
      </h2>

      {files.length === 0 ? (
        <p className="empty-state">No files have been attached yet.</p>
      ) : (
        <ul className="file-list">
          {files.map((file) => {
            const type = file.mimeType === "application/pdf" ? "PDF" : "TXT";
            const nameId = `file-name-${file.id}`;

            return (
              <li
                key={file.id}
                className={`file-item ${file.isActive ? "" : "is-disabled"}`}
              >
                <div className="file-row">
                  <span
                    className={`file-icon file-icon-${type.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {type}
                  </span>

                  <div className="file-info">
                    {/* Private file: served only by the authorized download route */}
                    <a
                      id={nameId}
                      href={`/api/files/${file.id}/download`}
                      className="file-link"
                    >
                      {file.originalName}
                    </a>
                    <span className="content-meta">
                      {type} · {formatSize(file.sizeBytes)} · v{file.version}
                      {file.uploaderName ? ` · Uploaded by ${file.uploaderName}` : ""}
                    </span>
                    <span className="file-status-row" aria-live="polite">
                      <span
                        className={`badge badge-processing-${file.status}`}
                        data-testid={`file-status-${file.id}`}
                      >
                        {FILE_STATUS_LABELS[file.status]}
                      </span>
                      {!file.isActive && (
                        <span className="badge badge-file-disabled">Disabled</span>
                      )}
                      {file.status === "ready" && file.isActive && (
                        <span className="content-meta">Searchable</span>
                      )}
                    </span>
                  </div>

                  <div className="file-actions">
                    <a
                      href={`/api/files/${file.id}/download`}
                      className="btn btn-secondary btn-sm"
                      aria-describedby={nameId}
                    >
                      Download
                    </a>
                    {canManage && (
                      <>
                        {file.status === "failed" && file.isActive && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            aria-describedby={nameId}
                            disabled={isBusy}
                            onClick={() => handleRetry(file.id)}
                          >
                            Retry
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          aria-describedby={nameId}
                          aria-expanded={replacingId === file.id}
                          disabled={isBusy}
                          onClick={() => {
                            setError("");
                            setReplacingId(replacingId === file.id ? null : file.id);
                          }}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className="btn btn-archive btn-sm"
                          aria-describedby={nameId}
                          disabled={isBusy}
                          onClick={() => handleToggle(file)}
                        >
                          {file.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          aria-describedby={nameId}
                          disabled={isBusy}
                          onClick={() => handleDelete(file.id)}
                        >
                          Delete file
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {file.error && file.status !== "ready" && (
                  <p className="file-processing-error" dir="rtl">
                    {file.error}
                  </p>
                )}

                {canManage && replacingId === file.id && (
                  <form
                    className="file-replace-form"
                    onSubmit={(event) => handleReplace(event, file.id)}
                  >
                    <label htmlFor={`replace-input-${file.id}`}>
                      New version of “{file.originalName}” (PDF or TXT, max 10 MB)
                    </label>
                    <input
                      id={`replace-input-${file.id}`}
                      ref={replaceRef}
                      type="file"
                      accept=".pdf,.txt,application/pdf,text/plain"
                    />
                    <div className="inline-actions">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={isBusy}>
                        {isBusy ? "Uploading..." : "Upload new version"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setReplacingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="form-error" role="alert" dir="rtl">
          {error}
        </p>
      )}

      {canManage && (
        <form className="file-upload-form" onSubmit={handleUpload}>
          <label htmlFor={`file-input-${kind}-${parentId}`}>
            Attach a PDF or TXT file (max 10 MB)
          </label>
          <input
            id={`file-input-${kind}-${parentId}`}
            ref={inputRef}
            type="file"
            name="file"
            accept=".pdf,.txt,application/pdf,text/plain"
          />
          <p className="form-hint">
            Files are stored privately and can only be downloaded by people who
            can read this {kind === "post" ? "post" : "page"}. Their text is
            processed in the background and then becomes searchable.
          </p>
          <button type="submit" className="btn btn-primary" disabled={isBusy}>
            {isBusy ? "Uploading..." : "Upload File"}
          </button>
        </form>
      )}
    </section>
  );
}

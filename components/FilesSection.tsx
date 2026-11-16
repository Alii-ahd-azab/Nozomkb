"use client";

import { useRef, useState } from "react";
import {
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  type FileItem,
  type ParentKind,
} from "@/lib/definitions";
import { AR } from "@/lib/messages";

type FilesSectionProps = {
  kind: ParentKind;
  parentId: number;
  initialFiles: FileItem[];
  // computed on the server; the upload/delete APIs check again
  canManage: boolean;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];

    // Quick browser-side checks for a nicer message (the server re-validates).
    if (!file) return setError(AR.fileMissing);

    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      return setError(AR.fileUnsupported);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) return setError(AR.fileTooLarge);

    setIsBusy(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `/api/${kind === "post" ? "posts" : "pages"}/${parentId}/files`,
        { method: "POST", body: formData }
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || AR.uploadFailed);
        return;
      }

      setFiles((previous) => [data as FileItem, ...previous]);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError(AR.uploadFailed);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this file?")) return;

    setIsBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/files/${id}`, { method: "DELETE" });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || AR.fileDeleteFailed);
        return;
      }

      setFiles((previous) => previous.filter((file) => file.id !== id));
    } catch {
      setError(AR.fileDeleteFailed);
    } finally {
      setIsBusy(false);
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
              <li key={file.id} className="file-item">
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
                    {type} · {formatSize(file.sizeBytes)}
                    {file.uploaderName ? ` · Uploaded by ${file.uploaderName}` : ""}
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
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      aria-describedby={nameId}
                      disabled={isBusy}
                      onClick={() => handleDelete(file.id)}
                    >
                      Delete file
                    </button>
                  )}
                </div>
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
            can read this {kind === "post" ? "post" : "page"}.
          </p>
          <button type="submit" className="btn btn-primary" disabled={isBusy}>
            {isBusy ? "Uploading..." : "Upload File"}
          </button>
        </form>
      )}
    </section>
  );
}

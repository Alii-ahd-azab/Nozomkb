"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ContentScope,
  ContentStatus,
  Department,
  OfficialPage,
} from "@/lib/definitions";

type OfficialPageFormProps = {
  // Present = edit mode, missing = create mode.
  page?: OfficialPage;
  // Only filled for Admins (who may choose any department).
  departments: Department[];
  userDepartmentId: number | null;
  userDepartmentName: string | null;
};

export default function OfficialPageForm({
  page,
  departments,
  userDepartmentId,
  userDepartmentName,
}: OfficialPageFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(page);
  const canChooseDepartment = departments.length > 0;

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [content, setContent] = useState(page?.content ?? "");
  const [status, setStatus] = useState<ContentStatus>(page?.status ?? "draft");
  const [scope, setScope] = useState<ContentScope>(page?.scope ?? "company");
  const [departmentId, setDepartmentId] = useState<string>(
    String(page?.departmentId ?? userDepartmentId ?? "")
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !content.trim()) {
      setError("Title and content are required.");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(
        isEditMode ? `/api/pages/${page?.id}` : "/api/pages",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            status,
            scope,
            // The server ignores/rejects this for non-Admins.
            ...(scope === "department" && canChooseDepartment
              ? { departmentId: Number(departmentId) }
              : {}),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to save the page.");
        return;
      }

      setIsOpen(false);

      if (isEditMode) {
        router.refresh();
      } else {
        setTitle("");
        setContent("");
        setStatus("draft");
        setScope("company");
        router.push(`/official/${data.id}`);
      }
    } catch {
      setError("Something went wrong while saving the page.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="post-actions">
      <div className="add-post-button-row">
        <button
          type="button"
          className={`toggle-form-button ${isOpen ? "form-open" : ""}`}
          onClick={() => setIsOpen((previous) => !previous)}
        >
          {isOpen
            ? "Hide Form"
            : isEditMode
              ? "Edit / Publish / Archive"
              : "+ New Official Page"}
        </button>
      </div>

      {isOpen && (
        <form className="post-form" onSubmit={handleSubmit}>
          <h2>{isEditMode ? "Manage Official Page" : "New Official Page"}</h2>

          {error && <p className="form-error">{error}</p>}

          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <textarea
            placeholder="Content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />

          <label htmlFor="page-status">Status</label>
          <select
            id="page-status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as ContentStatus)
            }
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            {isEditMode && <option value="archived">Archived</option>}
          </select>

          <label htmlFor="page-scope">Who can read it?</label>
          <select
            id="page-scope"
            value={scope}
            onChange={(event) =>
              setScope(event.target.value as ContentScope)
            }
          >
            <option value="company">Whole company</option>
            {(canChooseDepartment || userDepartmentName) && (
              <option value="department">
                {canChooseDepartment
                  ? "One department"
                  : `Only ${userDepartmentName}`}
              </option>
            )}
          </select>

          {scope === "department" && canChooseDepartment && (
            <>
              <label htmlFor="page-department">Department</label>
              <select
                id="page-department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </form>
      )}
    </div>
  );
}

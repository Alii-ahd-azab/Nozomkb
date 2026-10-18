"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PostActionsProps = {
  id: number;
  title: string;
  content: string;
};

export default function PostActions({
  id,
  title,
  content,
}: PostActionsProps) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [editedContent, setEditedContent] = useState(content);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);



async function handleUpdate(
  event: React.FormEvent<HTMLFormElement>
) {
  event.preventDefault();

  if (!editedTitle.trim() || !editedContent.trim()) {
    setError("Title and content are required.");
    return;
  }

  if (
  editedTitle.trim() === title.trim() &&
  editedContent.trim() === content.trim()
) {
  setError("No changes were made.");
  return;
}

  setError("");
  setIsSaving(true);

  try {
    const response = await fetch(`/api/posts/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: editedTitle,
        content: editedContent,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Failed to update post.");
      return;
    }

    setIsEditing(false);
    router.refresh();
  } catch {
    setError("Something went wrong while updating the post.");
  } finally {
    setIsSaving(false);
  }
}



async function handleDelete() {
  const confirmed = window.confirm(
    "Are you sure you want to delete this post?"
  );

  if (!confirmed) {
    return;
  }

  setError("");
  setIsDeleting(true);

  try {
    const response = await fetch(`/api/posts/${id}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Failed to delete post.");
      return;
    }

    router.push("/feed");
    router.refresh();
  } catch {
    setError("Something went wrong while deleting the post.");
  } finally {
    setIsDeleting(false);
  }
}



  return (
<div className="post-actions">
  {!isEditing ? (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
    >
      Edit Post
    </button>
  ) : (
    <form onSubmit={handleUpdate}>
      <input
        type="text"
        value={editedTitle}
        onChange={(event) =>
          setEditedTitle(event.target.value)
        }
      />

      <textarea
        value={editedContent}
        onChange={(event) =>
          setEditedContent(event.target.value)
        }
      />

      <button
  type="submit"
  disabled={isSaving}
>
  {isSaving ? "Saving..." : "Save Changes"}
    </button>


      <button
        type="button"
        onClick={() => {
        setIsEditing(false);
        setError("");
      }}
      >
        Cancel
      </button>
    </form>
  )}

  {error && (
    <p className="form-error">
      {error}
    </p>
  )}

<button
  type="button"
  onClick={handleDelete}
  disabled={isDeleting}
>
  {isDeleting ? "Deleting..." : "Delete Post"}
</button>

</div>
  );
}
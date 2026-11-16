"use client";

import { useState } from "react";
import {
  COMMENT_MAX_LENGTH,
  type CommentItem,
  type ParentKind,
} from "@/lib/definitions";
import { AR } from "@/lib/messages";

type CommentsSectionProps = {
  kind: ParentKind;
  parentId: number;
  initialComments: CommentItem[];
};

export default function CommentsSection({
  kind,
  parentId,
  initialComments,
}: CommentsSectionProps) {
  const [comments, setComments] = useState(initialComments);
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const basePath = kind === "post" ? "/api/posts" : "/api/pages";

  function validate(text: string) {
    if (!text.trim()) return AR.commentRequired;
    if (text.trim().length > COMMENT_MAX_LENGTH) return AR.commentTooLong;
    return "";
  }

  async function send(url: string, method: string, body?: object) {
    setIsBusy(true);
    setError("");

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || AR.commentFailed);
        return null;
      }

      return data;
    } catch {
      setError(AR.commentFailed);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate(newComment);
    if (problem) return setError(problem);

    // No userId: the server uses the signed-in user as the author.
    const created = await send(`${basePath}/${parentId}/comments`, "POST", {
      content: newComment,
    });

    if (created) {
      setComments((previous) => [...previous, created as CommentItem]);
      setNewComment("");
    }
  }

  async function handleSave(id: number) {
    const problem = validate(editText);
    if (problem) return setError(problem);

    const updated = await send(`/api/comments/${id}`, "PATCH", {
      content: editText,
    });

    if (updated) {
      setComments((previous) =>
        previous.map((comment) =>
          comment.id === id ? (updated as CommentItem) : comment
        )
      );
      setEditingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this comment?")) return;

    if (await send(`/api/comments/${id}`, "DELETE")) {
      setComments((previous) => previous.filter((comment) => comment.id !== id));
    }
  }

  return (
    <section className="detail-section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">
        Comments <span className="count-pill">{comments.length}</span>
      </h2>

      {comments.length === 0 ? (
        <p className="empty-state">
          No comments yet. Be the first to share a note or question.
        </p>
      ) : (
        <ul className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="comment-item">
              <span className="comment-avatar" aria-hidden="true">
                {comment.authorName.trim().charAt(0).toUpperCase()}
              </span>

              <div className="comment-body">
                <p className="comment-head">
                  <span className="comment-author">
                    {comment.authorName}
                  </span>
                  <span className="content-meta">
                    {new Date(comment.createdAt).toLocaleString("en-GB")}
                    {comment.updatedAt !== comment.createdAt && (
                      <span className="comment-edited"> · edited</span>
                    )}
                  </span>
                </p>

                {editingId === comment.id ? (
                  <div className="comment-edit">
                    <textarea
                      aria-label="Edit comment"
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                    />
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() => handleSave(comment.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="comment-text">{comment.content}</p>
                )}

                {/* UX only: PATCH/DELETE /api/comments/[id] re-check on the server */}
                {comment.canEdit && editingId !== comment.id && (
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditText(comment.content);
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={isBusy}
                      onClick={() => handleDelete(comment.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="form-error" role="alert" dir="rtl">
          {error}
        </p>
      )}

      <form className="comment-form" onSubmit={handleAdd}>
        <label htmlFor={`new-comment-${kind}-${parentId}`}>Add a comment</label>
        <textarea
          id={`new-comment-${kind}-${parentId}`}
          value={newComment}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Share a note, tip or question…"
          onChange={(event) => setNewComment(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={isBusy}>
          {isBusy ? "Saving..." : "Add Comment"}
        </button>
      </form>
    </section>
  );
}

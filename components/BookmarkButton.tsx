"use client";

import { useState } from "react";
import type { ParentKind } from "@/lib/definitions";
import { AR } from "@/lib/messages";

type BookmarkButtonProps = {
  kind: ParentKind;
  id: number;
  initialBookmarked: boolean;
};

export default function BookmarkButton({
  kind,
  id,
  initialBookmarked,
}: BookmarkButtonProps) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function toggle() {
    setIsBusy(true);
    setError("");

    try {
      const response = await fetch("/api/bookmarks", {
        method: bookmarked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });

      // 409 = already saved; 404 on remove = already removed.
      if (response.ok || response.status === 409 || (bookmarked && response.status === 404)) {
        setBookmarked(!bookmarked);
        return;
      }

      const data = await response.json().catch(() => ({}));
      setError(data.error || AR.bookmarkFailed);
    } catch {
      setError(AR.bookmarkFailed);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="bookmark-control">
      <button
        type="button"
        className={`btn bookmark-button ${bookmarked ? "is-bookmarked" : ""}`}
        aria-pressed={bookmarked}
        disabled={isBusy}
        onClick={toggle}
      >
        {bookmarked ? "★ Bookmarked" : "☆ Bookmark"}
      </button>
      {error && (
        <p className="form-error" role="alert" dir="rtl">
          {error}
        </p>
      )}
    </div>
  );
}

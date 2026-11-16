import Link from "next/link";
import Layout from "@/components/Layout";
import { requireUser } from "@/lib/current-user";
import { listReadableBookmarks } from "@/lib/bookmarks";
import { parentHref } from "@/lib/definitions";

export default async function BookmarksPage() {
  const user = await requireUser("/bookmarks");

  // Only this user's bookmarks, re-checked against CURRENT access, so content
  // that became draft/archived/restricted is not revealed here.
  const bookmarks = await listReadableBookmarks(user);

  return (
    <Layout>
      <main>
        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Saved Knowledge</p>
            <h1>My Bookmarks</h1>
            <p>{bookmarks.length} saved items</p>
          </div>

          {bookmarks.length === 0 ? (
            <div className="no-results">
              <h2>No bookmarks yet</h2>
              <p>
                Use the ☆ Bookmark button on a Post or Official Page to save it here.
              </p>
            </div>
          ) : (
            <div className="feed-list">
              {bookmarks.map((bookmark) => (
                <Link
                  key={`${bookmark.kind}-${bookmark.id}`}
                  href={parentHref(bookmark.kind, bookmark.id)}
                  className="post-card-link"
                >
                  <article className={`post-card ${bookmark.kind === "page" ? "post-card-official" : ""}`}>
                    <div className="content-badges">
                      <span
                        className={`badge ${bookmark.kind === "page" ? "badge-official" : "badge-community"}`}
                      >
                        {bookmark.kind === "page" ? "Official" : "Community"}
                      </span>
                      <span className="badge badge-scope">
                        {bookmark.scope === "company"
                          ? "Company-wide"
                          : `Department: ${bookmark.departmentName ?? "Unknown"}`}
                      </span>
                    </div>
                    <h2>{bookmark.title}</h2>
                    <div className="card-footer">
                      <span className="content-meta">
                        ★ Saved {new Date(bookmark.createdAt).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}

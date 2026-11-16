import Link from "next/link";
import Layout from "@/components/Layout";
import { requireUser } from "@/lib/current-user";
import { isAdmin } from "@/lib/authz";
import { getDepartments } from "@/lib/departments";
import { getTagNames } from "@/lib/tags";
import { parentHref } from "@/lib/definitions";
import { AR } from "@/lib/messages";
import {
  parseSearchParams,
  searchContent,
  type SearchParams,
} from "@/lib/search";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TYPE_LABELS = {
  page: "Official Page",
  post: "Community Post",
  comment: "Comment",
} as const;

// Plain GET form: works without JavaScript, and every result is computed on
// the server for the signed-in user (published + permitted only).
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = await searchParams;
  const user = await requireUser("/search");

  const [departments, tags] = await Promise.all([getDepartments(), getTagNames()]);

  // Department options are a convenience only; the query never widens access.
  const departmentOptions = isAdmin(user)
    ? departments
    : departments.filter((department) => department.id === user.departmentId);

  const hasQuery = typeof raw.q === "string" && raw.q.trim() !== "";
  const parsed = hasQuery ? parseSearchParams(raw) : null;

  let data: Awaited<ReturnType<typeof searchContent>> | null = null;
  let errorMessage = parsed && !parsed.ok ? parsed.error : "";

  if (parsed?.ok) {
    try {
      data = await searchContent(user, parsed.value);
    } catch (error) {
      console.error(error);
      errorMessage = AR.searchFailed;
    }
  }

  const current: SearchParams = parsed?.ok
    ? parsed.value
    : { q: "", type: "all", department: "all", tag: null, page: 1 };

  function pageHref(page: number) {
    const params = new URLSearchParams({
      q: current.q,
      type: current.type,
      department: current.department,
      tag: current.tag ?? "all",
      page: String(page),
    });

    return `/search?${params.toString()}`;
  }

  return (
    <Layout>
      <main>
        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Keyword Search</p>
            <h1>Search</h1>
            <p>Search published Official Pages, Community Posts and Comments you can access.</p>
          </div>

          <form className="feed-controls search-form" action="/search" method="get">
            <label htmlFor="search-q">Keyword</label>
            <input
              id="search-q"
              name="q"
              type="search"
              defaultValue={current.q}
              maxLength={100}
              placeholder="e.g. leave, printer, payroll..."
            />

            <label htmlFor="search-type">Type</label>
            <select id="search-type" name="type" defaultValue={current.type}>
              <option value="all">All</option>
              <option value="page">Official Pages</option>
              <option value="post">Community Posts</option>
              <option value="comment">Comments</option>
            </select>

            <label htmlFor="search-department">Department</label>
            <select id="search-department" name="department" defaultValue={current.department}>
              <option value="all">All</option>
              <option value="company">Company-wide only</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={String(department.id)}>
                  {department.name}
                </option>
              ))}
            </select>

            <label htmlFor="search-tag">Tag</label>
            <select id="search-tag" name="tag" defaultValue={current.tag ?? "all"}>
              <option value="all">All</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>

            <button type="submit">Search</button>
          </form>

          {errorMessage && (
            <p className="form-error" role="alert" dir="rtl">
              {errorMessage}
            </p>
          )}

          {!hasQuery && (
            <div className="no-results">
              <h2>Start searching</h2>
              <p>Type a keyword and press Search.</p>
            </div>
          )}

          {data && (
            <>
              <p className="content-meta search-summary">
                {data.total} result{data.total === 1 ? "" : "s"} for “{current.q}”
                {data.total > 0 && ` · page ${data.page} of ${data.totalPages}`}
              </p>

              {data.results.length === 0 ? (
                <div className="no-results">
                  <h2>No results</h2>
                  <p>
                    Nothing you can access matches “{current.q}”. Try another keyword or
                    clear the filters.
                  </p>
                </div>
              ) : (
                <ol className="search-results">
                  {data.results.map((result) => (
                    <li key={`${result.type}-${result.id}`} className="post-card search-result">
                      <div className="content-badges">
                        <span className={`badge badge-type-${result.type}`}>
                          {TYPE_LABELS[result.type]}
                        </span>
                        <span className="badge badge-scope">
                          {result.scope === "company"
                            ? "Company-wide"
                            : `Department: ${result.departmentName ?? "Unknown"}`}
                        </span>
                      </div>

                      <h2>
                        <Link href={parentHref(result.parentKind, result.parentId)}>
                          {result.type === "comment"
                            ? `Comment on “${result.parentTitle}”`
                            : result.title}
                        </Link>
                      </h2>
                      <p>{result.snippet}</p>
                    </li>
                  ))}
                </ol>
              )}

              {data.totalPages > 1 && (
                <nav className="pagination" aria-label="Search pages">
                  {data.page > 1 ? (
                    <Link href={pageHref(data.page - 1)}>← Previous</Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    Page {data.page} of {data.totalPages}
                  </span>
                  {data.page < data.totalPages ? (
                    <Link href={pageHref(data.page + 1)}>Next →</Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}
        </section>
      </main>
    </Layout>
  );
}

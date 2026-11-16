import Link from "next/link";
import Layout from "@/components/Layout";
import { requireUser } from "@/lib/current-user";
import { isAdmin } from "@/lib/authz";
import { getDepartments } from "@/lib/departments";
import { getTagNames } from "@/lib/tags";
import { parentHref, type SemanticSearchResult } from "@/lib/definitions";
import { AR } from "@/lib/messages";
import {
  MAX_SEMANTIC_QUERY_LENGTH,
  parseSearchParams,
  searchContent,
  type SearchParams,
} from "@/lib/search";
import {
  getEmbeddingInfo,
  semanticSearch,
  SemanticSearchUnavailableError,
} from "@/lib/semantic-search";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TYPE_LABELS = {
  page: "Official Page",
  post: "Community Post",
  comment: "Comment",
  file: "File",
} as const;

type KeywordData = Awaited<ReturnType<typeof searchContent>>;
type SemanticData = Awaited<ReturnType<typeof semanticSearch>>;

// Plain GET form: works without JavaScript, and every result is computed on
// the server for the signed-in user (published + permitted only).
// Week 8: Mode = Keyword (exact words, Week 6/7) or Semantic (by meaning).
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

  let keywordData: KeywordData | null = null;
  let semanticData: SemanticData | null = null;
  let errorMessage = parsed && !parsed.ok ? parsed.error : "";

  if (parsed?.ok) {
    try {
      if (parsed.value.mode === "semantic") {
        semanticData = await semanticSearch(user, parsed.value);
      } else {
        keywordData = await searchContent(user, parsed.value);
      }
    } catch (error) {
      if (error instanceof SemanticSearchUnavailableError) {
        errorMessage = AR.semanticSearchUnavailable;
      } else {
        console.error(error);
        errorMessage = AR.searchFailed;
      }
    }
  }

  const requestedMode = raw.mode === "semantic" ? "semantic" : "keyword";

  const current: SearchParams = parsed?.ok
    ? parsed.value
    : { mode: requestedMode, q: "", type: "all", department: "all", tag: null, page: 1 };

  const semantic = current.mode === "semantic";
  const embedding = semantic ? getEmbeddingInfo() : null;

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
            <p className="eyebrow">{semantic ? "Semantic Search" : "Keyword Search"}</p>
            <h1>Search</h1>
            <p>
              {semantic
                ? "Search by meaning: results are ranked by how close they are to your question, even when the words differ. Only published content you can access is searched."
                : "Search published Official Pages, Community Posts, Comments and the text of attached Files you can access."}
            </p>
          </div>

          <form className="feed-controls search-form" action="/search" method="get">
            <div className="search-main">
              <div className="field search-mode">
                <label htmlFor="search-mode">Mode</label>
                <select id="search-mode" name="mode" defaultValue={current.mode}>
                  <option value="keyword">Keyword</option>
                  <option value="semantic">Semantic</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="search-q">{semantic ? "Question" : "Keyword"}</label>
                <input
                  id="search-q"
                  name="q"
                  type="search"
                  defaultValue={current.q}
                  maxLength={MAX_SEMANTIC_QUERY_LENGTH}
                  placeholder={
                    semantic
                      ? "e.g. how many vacation days do I get?"
                      : "e.g. leave, printer, payroll..."
                  }
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Search
              </button>
            </div>

            <div className="search-filters">
              <div className="field">
                <label htmlFor="search-type">Type</label>
                <select id="search-type" name="type" defaultValue={current.type}>
                  <option value="all">All</option>
                  <option value="page">Official Pages</option>
                  <option value="post">Community Posts</option>
                  <option value="comment">Comments</option>
                  <option value="file">Files</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="search-department">Department</label>
                <select
                  id="search-department"
                  name="department"
                  defaultValue={current.department}
                >
                  <option value="all">All</option>
                  <option value="company">Company-wide only</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={String(department.id)}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="search-tag">Tag</label>
                <select id="search-tag" name="tag" defaultValue={current.tag ?? "all"}>
                  <option value="all">All</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </form>

          {embedding?.testOnly && (
            <p className="search-test-notice" role="note">
              TEST ONLY embeddings are active (deterministic fake vectors for automated
              tests). These results say nothing about real semantic quality.
            </p>
          )}

          {errorMessage && (
            <p className="form-error" role="alert" dir="rtl">
              {errorMessage}
            </p>
          )}

          {!hasQuery && (
            <div className="no-results">
              <h2>Start searching</h2>
              <p>
                {semantic
                  ? "Ask a question in your own words and press Search."
                  : "Type a keyword and press Search."}
              </p>
            </div>
          )}

          {keywordData && (
            <>
              <p className="content-meta search-summary">
                {keywordData.total} result{keywordData.total === 1 ? "" : "s"} for “{current.q}”
                {keywordData.total > 0 &&
                  ` · page ${keywordData.page} of ${keywordData.totalPages}`}
              </p>

              {keywordData.results.length === 0 ? (
                <div className="no-results">
                  <h2>No results</h2>
                  <p>
                    Nothing you can access matches “{current.q}”. Try another keyword,
                    Semantic mode, or clear the filters.
                  </p>
                </div>
              ) : (
                <ol className="search-results">
                  {keywordData.results.map((result) => (
                    <li
                      key={`${result.type}-${result.id}`}
                      className={`post-card search-result ${result.type === "page" ? "post-card-official" : ""}`}
                    >
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

                      {/* Week 7: where the matching File text comes from */}
                      {result.file && (
                        <p className="content-meta search-source">
                          In{" "}
                          {result.parentKind === "page" ? "Official Page" : "Community Post"}{" "}
                          “{result.parentTitle}”
                          {result.file.pageNumber !== null &&
                            ` · Page ${result.file.pageNumber}`}
                        </p>
                      )}

                      <p className="card-excerpt">{result.snippet}</p>

                      {result.file && (
                        <a
                          href={`/api/files/${result.file.id}/download`}
                          className="btn btn-secondary btn-sm search-result-action"
                        >
                          Download file
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {keywordData.totalPages > 1 && (
                <nav className="pagination" aria-label="Search pages">
                  {keywordData.page > 1 ? (
                    <Link
                      href={pageHref(keywordData.page - 1)}
                      className="btn btn-secondary btn-sm"
                    >
                      ← Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    Page {keywordData.page} of {keywordData.totalPages}
                  </span>
                  {keywordData.page < keywordData.totalPages ? (
                    <Link
                      href={pageHref(keywordData.page + 1)}
                      className="btn btn-secondary btn-sm"
                    >
                      Next →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}

          {semanticData && (
            <>
              <p className="content-meta search-summary">
                Top {semanticData.results.length} result
                {semanticData.results.length === 1 ? "" : "s"} by meaning for “{current.q}”
              </p>

              {semanticData.results.length === 0 ? (
                <div className="no-results">
                  <h2>No results</h2>
                  <p>
                    Nothing you can access has been indexed for Semantic Search yet. Try
                    Keyword mode or clear the filters.
                  </p>
                </div>
              ) : (
                <ol className="search-results">
                  {semanticData.results.map((result) => (
                    <SemanticResultCard key={`${result.type}-${result.id}`} result={result} />
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </main>
    </Layout>
  );
}

function SemanticResultCard({ result }: { result: SemanticSearchResult }) {
  const parentLabel = result.parentKind === "page" ? "Official Page" : "Community Post";

  return (
    <li
      className={`post-card search-result ${result.type === "page" ? "post-card-official" : ""}`}
    >
      <div className="content-badges">
        <span className={`badge badge-type-${result.type}`}>{TYPE_LABELS[result.type]}</span>
        <span className="badge badge-scope">
          {result.scope === "company"
            ? "Company-wide"
            : `Department: ${result.departmentName ?? "Unknown"}`}
        </span>
        <span className="badge badge-similarity" title="Cosine similarity to your question">
          Similarity {result.similarity.toFixed(2)}
        </span>
      </div>

      <h2>
        <Link href={result.url}>
          {result.type === "comment" ? `Comment on “${result.parentTitle}”` : result.title}
        </Link>
      </h2>

      {(result.type === "comment" || result.file) && (
        <p className="content-meta search-source">
          In {parentLabel} “{result.parentTitle}”
          {result.file && ` · File version ${result.file.version}`}
          {result.file?.pageNumber != null && ` · Page ${result.file.pageNumber}`}
        </p>
      )}

      <p className="card-excerpt">{result.snippet}</p>

      <div className="search-result-actions">
        <Link href={result.url} className="btn btn-secondary btn-sm search-result-action">
          Open source
        </Link>
        {result.downloadUrl && (
          <a href={result.downloadUrl} className="btn btn-secondary btn-sm search-result-action">
            Download file
          </a>
        )}
      </div>
    </li>
  );
}

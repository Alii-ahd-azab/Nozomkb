import { getCurrentUser } from "@/lib/current-user";
import { parseSearchParams, searchContent } from "@/lib/search";
import { semanticSearch, SemanticSearchUnavailableError } from "@/lib/semantic-search";
import { jsonError } from "@/lib/api";
import { AR } from "@/lib/messages";
import { arServerError, arUnauthorized } from "@/lib/handlers/parent";

// GET /api/search?q=...&type=all|page|post|comment|file&department=all|company|<id>&tag=<name>&page=1
//   mode=keyword  (default) Week 6/7 Keyword Search (ILIKE), paginated
//   mode=semantic Week 8 Semantic Search (embeddings + pgvector), top 10
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return arUnauthorized();
    }

    const url = new URL(request.url);
    const parsed = parseSearchParams(Object.fromEntries(url.searchParams));

    if (!parsed.ok) {
      return jsonError(parsed.error, 400);
    }

    if (parsed.value.mode === "semantic") {
      try {
        return Response.json(await semanticSearch(user, parsed.value));
      } catch (error) {
        if (error instanceof SemanticSearchUnavailableError) {
          return jsonError(AR.semanticSearchUnavailable, 503);
        }
        throw error;
      }
    }

    return Response.json(await searchContent(user, parsed.value));
  } catch (error) {
    return arServerError(error, AR.searchFailed);
  }
}

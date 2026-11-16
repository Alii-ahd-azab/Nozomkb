import { getCurrentUser } from "@/lib/current-user";
import { parseSearchParams, searchContent } from "@/lib/search";
import { jsonError } from "@/lib/api";
import { AR } from "@/lib/messages";
import { arServerError, arUnauthorized } from "@/lib/handlers/parent";

// GET /api/search?q=...&type=all|page|post|comment&department=all|company|<id>&tag=<name>&page=1
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

    return Response.json(await searchContent(user, parsed.value));
  } catch (error) {
    return arServerError(error, AR.searchFailed);
  }
}

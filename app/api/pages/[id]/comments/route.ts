import { commentRoutes } from "@/lib/handlers/comments";

// GET: list Comments on an Official Page / POST: add a Comment.
export const { GET, POST } = commentRoutes("page");

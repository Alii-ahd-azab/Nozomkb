import { commentRoutes } from "@/lib/handlers/comments";

// GET: list Comments on a Post / POST: add a Comment (parent access required).
export const { GET, POST } = commentRoutes("post");

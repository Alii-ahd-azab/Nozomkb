import { fileRoutes } from "@/lib/handlers/files";

// GET: list Files on a Post / POST: upload (Post owner or Admin only).
export const { GET, POST } = fileRoutes("post");

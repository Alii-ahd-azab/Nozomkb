import { fileRoutes } from "@/lib/handlers/files";

// GET: list Files on an Official Page / POST: upload (Editor in scope or Admin).
export const { GET, POST } = fileRoutes("page");

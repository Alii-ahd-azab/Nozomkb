import { createPost,
  getPosts,
 } from "@/lib/posts";

export async function GET() {
  const posts = await getPosts();

  return Response.json(posts);
}

export async function POST(request: Request) {
  const body = await request.json();

  const title = body.title?.trim();
  const content = body.content?.trim();
  const userId = Number(body.userId);
  const tag = body.tag?.trim();

  if (!title || !content || !userId) {
    return Response.json(
      {
        error: "Title, content, and userId are required.",
      },
      {
        status: 400,
      }
    );
  }

const newPost = await createPost(
  title,
  content,
  userId,
  tag
);

return Response.json(
  newPost,
  {
    status: 201,
  }
);}

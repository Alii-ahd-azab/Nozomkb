import {
  deletePost,
  updatePost,
} from "@/lib/posts";


export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const title = body.title?.trim();
  const content = body.content?.trim();

  if (!title || !content) {
    return Response.json(
      {
        error: "Title and content are required.",
      },
      {
        status: 400,
      }
    );
  }

  const updatedPost = await updatePost(
    Number(id),
    title,
    content
  );

  if (!updatedPost) {
    return Response.json(
      {
        error: "Post not found.",
      },
      {
        status: 404,
      }
    );
  }

  return Response.json(updatedPost);
}



export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const deletedPost = await deletePost(Number(id));

  if (!deletedPost) {
    return Response.json(
      {
        error: "Post not found.",
      },
      {
        status: 404,
      }
    );
  }

  return Response.json({
    message: "Post deleted successfully.",
  });
}
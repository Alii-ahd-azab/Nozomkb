import Link from "next/link";
import { getPostById } from "@/lib/posts";
import PostActions from "@/components/PostActions";

type PostDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PostDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const post = await getPostById(Number(id));

  if (!post) {
    return (
      <main>
        <h1>Post not found</h1>
        <Link href="/feed">Back to Feed</Link>
      </main>
    );
  }

  return (
    <main className="post-details-page">
      <article className="post-details-card">
        <span className="post-tag">{post.tag}</span>

        <h1>{post.title}</h1>

        <p>{post.content}</p>
        
        <PostActions
        id={post.id}
        title={post.title}
        content={post.content}
        />

        <Link href="/feed" className="back-link">
          Back to Feed
        </Link>
      </article>
    </main>
  );
}
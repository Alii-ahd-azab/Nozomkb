import Link from "next/link";
import { posts } from "@/data/posts";

type PostDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PostDetailsPage({
  params,
}: PostDetailsPageProps) {
  const { id } = await params;

  const post = posts.find((post) => post.id === Number(id));

  if (!post) {
    return (
      <main>
        <h1>Post not found</h1>
        <Link href="/">Back to Feed</Link>
      </main>
    );
  }

  return (
    <main className="post-details-page">
      <article className="post-details-card">
        <span className="post-tag">{post.tag}</span>

        <h1>{post.title}</h1>

        <p>{post.content}</p>

        <Link href="/" className="back-link">
          Back to Feed
        </Link>
      </article>
    </main>
  );
}
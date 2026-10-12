import Layout from "@/components/Layout";
import FeedClient from "@/components/FeedClient";
import { getPosts } from "@/lib/posts";

export default async function FeedPage() {
  const posts = await getPosts();

  return (
    <Layout>
      <main>
        <FeedClient initialPosts={posts} />
      </main>
    </Layout>
  );
}
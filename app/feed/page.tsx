import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import { posts, type Post } from "@/data/posts";

function getPostCount(posts: Post[]) {
  return posts.length;
}

export default function FeedPage() {
  return (
    <Layout>
      <main>
        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Employee Knowledge</p>
            <h1>Knowledge Feed</h1>
            <p>{getPostCount(posts)} posts available</p>
          </div>

          <div className="feed-list">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                id={post.id}
                title={post.title}
                content={post.content}
                tag={post.tag}
              />
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
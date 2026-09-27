import PostCard from "@/components/PostCard";
import Layout from "@/components/Layout";
import { posts, type Post } from "@/data/posts";


function getPostCount(posts: Post[]) {
  return posts.length;
}

export default function Home() {
  return (
<Layout>
  <main>
  <div id="about" className="about-card">
    <p className="eyebrow">Internal Knowledge Platform</p>
    <h1>Nozom Knowledge Bank</h1>

    <p>
      An internal platform where Nozom employees can find company knowledge
      and share useful experience.
    </p>

    <div className="features">
  <div>
    <h2>Find knowledge</h2>
    <p>Search company information, policies, and useful employee knowledge.</p>
  </div>

  <div>
    <h2>Share experience</h2>
    <p>Employees can contribute useful posts and practical knowledge.</p>
  </div>
  </div>
  </div>
  
<section id="feed" className="feed-section">
  <div className="feed-header">
    <p className="eyebrow">Employee Knowledge</p>
    <h2>Knowledge Feed</h2>
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

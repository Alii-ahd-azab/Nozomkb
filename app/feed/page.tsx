"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import { posts, type Post } from "@/data/posts";

function getPostCount(posts: Post[]) {
  return posts.length;
}


export default function FeedPage() {
  const [currentPosts, setCurrentPosts] = useState<Post[]>(posts);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);


  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!title.trim() || !content.trim() || !tag.trim()) {
    setError("Please fill in all fields.");
    return;
  }
  setError("");

  const newPost: Post = {
  id: Date.now(),
  title: title,
  content: content,
  tag: tag,
  };

  setCurrentPosts((previousPosts) => [
    newPost,
    ...previousPosts,
  ]);

  setTitle("");
  setContent("");
  setTag("");
  setShowForm(false);
}

  const availableTags = [
  "All",
  ...Array.from(new Set(currentPosts.map((post) => post.tag))),
];

  const postTagOptions = [
  "Work Process",
  "Accounting",
  "HR",
  "Projects",
  "IT",
];

  const filteredPosts = currentPosts.filter((post) => {
  const matchesTag =
    selectedTag === "All" || post.tag === selectedTag;

  const matchesSearch = post.title
    .toLowerCase()
    .includes(searchTerm.toLowerCase());

  return matchesTag && matchesSearch;
});


  return (
    <Layout>
      <main>
        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Employee Knowledge</p>
            <h1>Knowledge Feed</h1>
            <p>{getPostCount(filteredPosts)} posts available</p>
          </div>

          <div className="feed-controls">
  <label htmlFor="tag-filter">Filter by tag</label>

  <select
    id="tag-filter"
    value={selectedTag}
    onChange={(event) => setSelectedTag(event.target.value)}
  >
    {availableTags.map((tagOption) => (
      <option key={tagOption} value={tagOption}>
        {tagOption}
      </option>
    ))}
  </select>

  <label htmlFor="post-search">Search by title</label>

<input
  id="post-search"
  type="text"
  placeholder="Search posts..."
  value={searchTerm}
  onChange={(event) => setSearchTerm(event.target.value)}
/>

<button
  type="button"
  onClick={() => {
    setSelectedTag("All");
    setSearchTerm("");
  }}
>
  Clear Filters
</button>
</div>

<div className="add-post-button-row">
  <button
    type="button"
    className={`toggle-form-button ${showForm ? "form-open" : ""}`}
    onClick={() => setShowForm((previous) => !previous)}
  >
    {showForm ? "Hide Form" : "+ Add New Post"}
  </button>
</div>

{showForm && (
    <form 
    className="post-form"
   onSubmit={handleSubmit}
          >
  <h2>Add a Post</h2>
  {error && (
  <p className="form-error">
    {error}
  </p>
)}

  <input
    type="text"
    placeholder="Title"
    value={title}
    onChange={(event) => setTitle(event.target.value)}
  />

  <textarea
    placeholder="Content"
    value={content}
    onChange={(event) => setContent(event.target.value)}
  />

  <select
  value={tag}
  onChange={(event) => setTag(event.target.value)}
>
  <option value="">Select a tag</option>

  {postTagOptions.map((tagOption) => (
    <option key={tagOption} value={tagOption}>
      {tagOption}
    </option>
  ))}
</select>

  <button type="submit">
    Add Post
  </button>
</form>

)}
          <div className="feed-list">
  {filteredPosts.length > 0 ? (
    filteredPosts.map((post) => (
      <PostCard
        key={post.id}
        id={post.id}
        title={post.title}
        content={post.content}
        tag={post.tag}
      />
    ))
  ) : (
    <div className="no-results">
      <h2>No Results</h2>
      <p>No posts match your current search or filter.</p>
    </div>
  )}
</div>

        </section>
      </main>
    </Layout>
  );
}
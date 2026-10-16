"use client";

import { useState } from "react";
import PostCard from "@/components/PostCard";



type FeedPost = {
  id: number;
  title: string;
  content: string;
  tag: string;
};

type FeedClientProps = {
  initialPosts: FeedPost[];
};



function getPostCount(posts: FeedPost[]) {
    return posts.length;
}


export default function FeedClient({
  initialPosts,
}: FeedClientProps) {

const [currentPosts, setCurrentPosts] =
  useState<FeedPost[]>(initialPosts);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);


async function handleSubmit(
  event: React.FormEvent<HTMLFormElement>
) {
  event.preventDefault();

  if (!title.trim() || !content.trim() || !tag.trim()) {
    setError("Please fill in all fields.");
    return;
  }

  setError("");
  setIsSubmitting(true);

  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content,
        tag,
        userId: 1,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Failed to create post.");
      return;
    }

    const newPost: FeedPost = {
      id: data.id,
      title: data.title,
      content: data.content,
      tag: data.tag,
    };

    setCurrentPosts((previousPosts) => [
      newPost,
      ...previousPosts,
    ]);

    setTitle("");
    setContent("");
    setTag("");
    setShowForm(false);
  } catch {
    setError("Something went wrong while creating the post.");
  } finally {
    setIsSubmitting(false);
  }
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
{availableTags.map((tagOption, index) => (
  <option key={`${tagOption}-${index}`} value={tagOption}>
    {tagOption}
  </option>
))}  </select>

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

{postTagOptions.map((tagOption, index) => (
  <option key={`${tagOption}-${index}`} value={tagOption}>
    {tagOption}
  </option>
))}</select>

<button
  type="submit"
  disabled={isSubmitting}
>
  {isSubmitting ? "Adding..." : "Add Post"}
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
  );
}
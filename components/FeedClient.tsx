"use client";

import { useState } from "react";
import PostCard from "@/components/PostCard";
import type {
  ContentScope,
  ContentStatus,
  Post,
} from "@/lib/definitions";

type FeedClientProps = {
  initialPosts: Post[];
  userDepartmentName: string | null;
  // Loaded from the tags table, so every option really exists.
  tagOptions: string[];
};

type StatusFilter = "active" | ContentStatus;

function getPostCount(posts: Post[]) {
    return posts.length;
}


export default function FeedClient({
  initialPosts,
  userDepartmentName,
  tagOptions,
}: FeedClientProps) {

const [currentPosts, setCurrentPosts] =
  useState<Post[]>(initialPosts);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("");
  const [scope, setScope] = useState<ContentScope>("company");
  const [status, setStatus] = useState<ContentStatus>("published");
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("All");
  const [selectedStatus, setSelectedStatus] =
    useState<StatusFilter>("active");
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
    // No userId here: the server takes the author from the signed-in session.
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content,
        tag,
        scope,
        status,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Failed to create post.");
      return;
    }

    setCurrentPosts((previousPosts) => [
      data as Post,
      ...previousPosts,
    ]);

    setTitle("");
    setContent("");
    setTag("");
    setScope("company");
    setStatus("published");
    setShowForm(false);
  } catch {
    setError("Something went wrong while creating the post.");
  } finally {
    setIsSubmitting(false);
  }
}

  const availableTags = [
  "All",
  ...Array.from(
    new Set(currentPosts.map((post) => post.tag).filter(Boolean))
  ),
];

  const postTagOptions = tagOptions;

  const filteredPosts = currentPosts.filter((post) => {
  const matchesTag =
    selectedTag === "All" || post.tag === selectedTag;

  const matchesSearch = post.title
    .toLowerCase()
    .includes(searchTerm.toLowerCase());

  // "Active" hides archived content. Normal readers never receive other
  // people's drafts/archived posts from the server in the first place.
  const matchesStatus =
    selectedStatus === "active"
      ? post.status !== "archived"
      : post.status === selectedStatus;

  return matchesTag && matchesSearch && matchesStatus;
});


  return (

        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Employee Knowledge</p>
            <h1>Knowledge Feed</h1>
            <p>{getPostCount(filteredPosts)} posts available</p>
          </div>

          <div className="feed-controls">
            <div className="field field-grow">
              <label htmlFor="post-search">Search by title</label>
              <input
                id="post-search"
                type="text"
                placeholder="Search posts..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            <div className="field">
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
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="status-filter">Status</label>
              <select
                id="status-filter"
                value={selectedStatus}
                onChange={(event) =>
                  setSelectedStatus(event.target.value as StatusFilter)
                }
              >
                <option value="active">Active</option>
                <option value="published">Published</option>
                <option value="draft">My drafts</option>
                <option value="archived">Archived (managed)</option>
              </select>
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSelectedTag("All");
                setSelectedStatus("active");
                setSearchTerm("");
              }}
            >
              Clear Filters
            </button>
          </div>

          <div className="add-post-button-row">
            <button
              type="button"
              className={`btn ${showForm ? "btn-secondary" : "btn-primary"}`}
              aria-expanded={showForm}
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
  <h2>Add a Community Post</h2>
  {error && (
  <p className="form-error">
    {error}
  </p>
)}

  <input
    type="text"
    aria-label="Title"
    placeholder="Title"
    value={title}
    onChange={(event) => setTitle(event.target.value)}
  />

  <textarea
    aria-label="Content"
    placeholder="Content"
    value={content}
    onChange={(event) => setContent(event.target.value)}
  />

  <select
  aria-label="Tag"
  value={tag}
  onChange={(event) => setTag(event.target.value)}
>
  <option value="">Select a tag</option>

{postTagOptions.map((tagOption, index) => (
  <option key={`${tagOption}-${index}`} value={tagOption}>
    {tagOption}
  </option>
))}</select>

  <div className="form-grid">
    <div className="field">
      <label htmlFor="post-scope">Who can read it?</label>
      <select
        id="post-scope"
        value={scope}
        onChange={(event) => setScope(event.target.value as ContentScope)}
      >
        <option value="company">Whole company</option>
        {userDepartmentName && (
          <option value="department">
            Only my department ({userDepartmentName})
          </option>
        )}
      </select>
    </div>

    <div className="field">
      <label htmlFor="post-status">Status</label>
      <select
        id="post-status"
        value={status}
        onChange={(event) => setStatus(event.target.value as ContentStatus)}
      >
        <option value="published">Publish now</option>
        <option value="draft">Save as draft</option>
      </select>
    </div>
  </div>

<button
  type="submit"
  className="btn btn-primary"
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
        status={post.status}
        scope={post.scope}
        departmentName={post.departmentName}
        authorName={post.authorName}
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

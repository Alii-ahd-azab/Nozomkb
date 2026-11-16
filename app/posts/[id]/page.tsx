import Link from "next/link";
import { notFound } from "next/navigation";
import Layout from "@/components/Layout";
import ContentBadges from "@/components/ContentBadges";
import PostActions from "@/components/PostActions";
import ParentExtras from "@/components/ParentExtras";
import { requireUser } from "@/lib/current-user";
import { canEditPost, canReadPost } from "@/lib/authz";
import { getPostById } from "@/lib/posts";
import { parseId } from "@/lib/api";

type PostDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PostDetailsPage({
  params,
}: PostDetailsPageProps) {
  const { id } = await params;

  const user = await requireUser(`/posts/${id}`);

  const postId = parseId(id);
  const post = postId === null ? null : await getPostById(postId);

  // Typing the URL directly gets the same server check as normal navigation.
  // Missing and forbidden posts look the same (404) so nothing is revealed.
  if (!post || !canReadPost(user, post)) {
    notFound();
  }

  const canManage = canEditPost(user, post);

  return (
    <Layout>
      <main className="post-details-page">
        <article className="post-details-card">
          <ContentBadges
            kind="community"
            status={post.status}
            scope={post.scope}
            departmentName={post.departmentName}
          />

          {post.tag && <span className="post-tag">{post.tag}</span>}

          <h1>{post.title}</h1>

          <p className="content-meta">
            By {post.authorName ?? "Unknown author"} · Updated{" "}
            {new Date(post.updatedAt).toLocaleString("en-GB")}
          </p>

          <p>{post.content}</p>

          {/* UX only: the API checks ownership again on every request. */}
          {canManage && (
            <PostActions
              id={post.id}
              title={post.title}
              content={post.content}
              status={post.status}
              scope={post.scope}
              departmentLabel={
                post.authorId === user.id
                  ? user.departmentName
                  : "the author's department"
              }
            />
          )}

          <ParentExtras user={user} parent={{ ...post, kind: "post" }} />

          <Link href="/feed" className="back-link">
            Back to Feed
          </Link>
        </article>
      </main>
    </Layout>
  );
}

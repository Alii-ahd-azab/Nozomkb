import Link from "next/link";
import ContentBadges from "@/components/ContentBadges";
import type { ContentScope, ContentStatus } from "@/lib/definitions";

type PostCardProps = {
  id: number;
  title: string;
  content: string;
  tag: string;
  status: ContentStatus;
  scope: ContentScope;
  departmentName: string | null;
  authorName: string | null;
};

export default function PostCard({
  id,
  title,
  content,
  tag,
  status,
  scope,
  departmentName,
  authorName,
}: PostCardProps) {
  return (
    <Link href={`/posts/${id}`} className="post-card-link">
      <article className="post-card">
        <ContentBadges
          kind="community"
          status={status}
          scope={scope}
          departmentName={departmentName}
        />
        {tag && <span className="post-tag">{tag}</span>}
        <h2>{title}</h2>
        <p>{content}</p>
        {authorName && (
          <p className="content-meta">By {authorName}</p>
        )}
      </article>
    </Link>
  );
}

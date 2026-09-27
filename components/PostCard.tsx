import Link from "next/link";


type PostCardProps = {
  id: number;
  title: string;
  content: string;
  tag: string;

};

export default function PostCard({
  id,
  title,
  content,
  tag,
}: PostCardProps) {
  return (
    <Link href={`/posts/${id}`} className="post-card-link">
      <article className="post-card">
        <span className="post-tag">{tag}</span>
        <h2>{title}</h2>
        <p>{content}</p>
      </article>
    </Link>
  );
}
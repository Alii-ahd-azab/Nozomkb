type PostCardProps = {
  title: string;
  content: string;
  tag: string;

};

export default function PostCard({
  title,
  content,
  tag,
}: PostCardProps) {
  return (
    <article className="post-card">
      <span className="post-tag">{tag}</span>
      <h2>{title}</h2>
      <p>{content}</p>
    </article>
  );
}
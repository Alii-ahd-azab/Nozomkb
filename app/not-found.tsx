import Link from "next/link";

// Used for missing content AND content the user is not allowed to see,
// so a forbidden item cannot be told apart from a missing one.
export default function NotFound() {
  return (
    <main className="post-details-page">
      <article className="post-details-card">
        <h1>Content not found</h1>
        <p className="content-body">
          This content does not exist or is not available to your account.
        </p>
        <Link href="/feed" className="btn btn-secondary">
          Back to Feed
        </Link>
      </article>
    </main>
  );
}

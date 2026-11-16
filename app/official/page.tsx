import Link from "next/link";
import Layout from "@/components/Layout";
import ContentBadges from "@/components/ContentBadges";
import OfficialPageForm from "@/components/OfficialPageForm";
import { requireUser } from "@/lib/current-user";
import { canCreateOfficialPage, isAdmin } from "@/lib/authz";
import { getReadablePages } from "@/lib/pages";
import { getDepartments } from "@/lib/departments";

export default async function OfficialPagesPage() {
  const user = await requireUser("/official");

  // Only pages this user may read (scope + lifecycle + role).
  const pages = await getReadablePages(user);
  const canCreate = canCreateOfficialPage(user);
  const departments = canCreate && isAdmin(user) ? await getDepartments() : [];

  return (
    <Layout>
      <main>
        <section className="feed-section">
          <div className="feed-header">
            <p className="eyebrow">Approved Company Knowledge</p>
            <h1>Official Pages</h1>
            <p>{pages.length} pages available</p>
          </div>

          {/* UX only: POST /api/pages rejects Members on the server. */}
          {canCreate && (
            <OfficialPageForm
              departments={departments}
              userDepartmentId={user.departmentId}
              userDepartmentName={user.departmentName}
            />
          )}

          <div className="feed-list">
            {pages.length > 0 ? (
              pages.map((page) => (
                <Link
                  key={page.id}
                  href={`/official/${page.id}`}
                  className="post-card-link"
                >
                  <article className="post-card">
                    <ContentBadges
                      kind="official"
                      status={page.status}
                      scope={page.scope}
                      departmentName={page.departmentName}
                    />
                    <h2>{page.title}</h2>
                    <p>{page.content}</p>
                  </article>
                </Link>
              ))
            ) : (
              <div className="no-results">
                <h2>No Official Pages</h2>
                <p>There are no official pages available to you yet.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </Layout>
  );
}

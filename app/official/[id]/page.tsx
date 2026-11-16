import Link from "next/link";
import { notFound } from "next/navigation";
import Layout from "@/components/Layout";
import ContentBadges from "@/components/ContentBadges";
import OfficialPageForm from "@/components/OfficialPageForm";
import ParentExtras from "@/components/ParentExtras";
import { requireUser } from "@/lib/current-user";
import {
  canManageOfficialPage,
  canReadOfficialPage,
  isAdmin,
} from "@/lib/authz";
import { getPageById } from "@/lib/pages";
import { getDepartments } from "@/lib/departments";
import { parseId } from "@/lib/api";

type OfficialPageDetailsProps = {
  params: Promise<{ id: string }>;
};

export default async function OfficialPageDetails({
  params,
}: OfficialPageDetailsProps) {
  const { id } = await params;

  const user = await requireUser(`/official/${id}`);

  const pageId = parseId(id);
  const page = pageId === null ? null : await getPageById(pageId);

  // Wrong department, draft or archived (for non-managers) -> 404.
  if (!page || !canReadOfficialPage(user, page)) {
    notFound();
  }

  const canManage = canManageOfficialPage(user, page);
  const departments = canManage && isAdmin(user) ? await getDepartments() : [];

  return (
    <Layout>
      <main className="post-details-page">
        <article className="post-details-card">
          <ContentBadges
            kind="official"
            status={page.status}
            scope={page.scope}
            departmentName={page.departmentName}
          />

          <h1>{page.title}</h1>

          <p className="content-meta">
            Owner: {page.authorName ?? "Unknown"} · Updated{" "}
            {new Date(page.updatedAt).toLocaleString("en-GB")}
          </p>

          <p>{page.content}</p>

          {/* UX only: PATCH /api/pages/[id] re-checks the role on the server. */}
          {canManage && (
            <OfficialPageForm
              page={page}
              departments={departments}
              userDepartmentId={user.departmentId}
              userDepartmentName={user.departmentName}
            />
          )}

          <ParentExtras user={user} parent={{ ...page, kind: "page" }} />

          <Link href="/official" className="back-link">
            Back to Official Pages
          </Link>
        </article>
      </main>
    </Layout>
  );
}

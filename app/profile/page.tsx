import Layout from "@/components/Layout";
import SpecialtyForm from "@/components/SpecialtyForm";
import { requireUser } from "@/lib/current-user";
import { getProfile } from "@/lib/profile";

export default async function ProfilePage() {
  const user = await requireUser("/profile");
  const profile = await getProfile(user);

  return (
    <Layout>
      <main>
        <section className="post-details-card profile-card">
          <p className="eyebrow">Employee Profile</p>
          <h1>{profile.name}</h1>

          <dl className="profile-fields">
            <dt>Email</dt>
            <dd>{profile.email}</dd>
            <dt>Role</dt>
            <dd>
              <span className={`badge badge-role-${profile.role.toLowerCase()}`}>
                {profile.role}
              </span>
            </dd>
            <dt>Department</dt>
            <dd>{profile.departmentName ?? "Not assigned"}</dd>
            <dt>Specialty</dt>
            <dd data-testid="profile-specialty">{profile.specialty ?? "Not set"}</dd>
          </dl>

          <p className="content-meta">
            Role and department are managed by an administrator because they control
            access to content. You can update your specialty.
          </p>

          <SpecialtyForm initialSpecialty={profile.specialty ?? ""} />
        </section>
      </main>
    </Layout>
  );
}

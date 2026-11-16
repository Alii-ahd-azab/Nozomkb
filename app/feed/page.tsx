import Layout from "@/components/Layout";
import FeedClient from "@/components/FeedClient";
import { requireUser } from "@/lib/current-user";
import { getReadablePosts } from "@/lib/posts";
import { getTagNames } from "@/lib/tags";

export default async function FeedPage() {
  // Signed-out visitors are redirected to /login.
  const user = await requireUser("/feed");

  // The query itself only returns Posts this user may read.
  const [posts, tagOptions] = await Promise.all([
    getReadablePosts(user),
    getTagNames(),
  ]);

  return (
    <Layout>
      <main>
        <FeedClient
          initialPosts={posts}
          userDepartmentName={user.departmentName}
          tagOptions={tagOptions}
        />
      </main>
    </Layout>
  );
}

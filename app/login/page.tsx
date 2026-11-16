import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/current-user";

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
};

// Public page. There is intentionally NO sign-up page: accounts are
// provisioned by an administrator (internal platform).
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { callbackUrl, error } = await searchParams;
  const requested = typeof callbackUrl === "string" ? callbackUrl : "";
  const redirectTo =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/feed";

  if (await getCurrentUser()) {
    redirect(redirectTo);
  }

  return (
    <Layout>
      <main>
        <section className="login-card">
          <p className="eyebrow">Internal Knowledge Platform</p>
          <h1>Sign in</h1>
          <p className="content-meta">
            Use your Nozom account. Accounts are created by an administrator.
          </p>

          <LoginForm
            redirectTo={redirectTo}
            initialError={error ? "Invalid email or password." : undefined}
          />
        </section>
      </main>
    </Layout>
  );
}

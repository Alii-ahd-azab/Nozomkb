import Toolbar from "@/components/Toolbar";
import BackToTop from "@/components/BackToTop";
import { getCurrentUser } from "@/lib/current-user";

type LayoutProps = {
  children: React.ReactNode;
};

export default async function Layout({ children }: LayoutProps) {
  const user = await getCurrentUser();

  return (
    <div className="page-layout">
      <Toolbar
        user={
          user
            ? {
                name: user.name,
                role: user.role,
                departmentName: user.departmentName,
              }
            : null
        }
      />

      {children}
      <BackToTop />
    </div>
  );
}

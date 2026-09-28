import Toolbar from "@/components/Toolbar";
import BackToTop from "@/components/BackToTop";

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="page-layout">
      <Toolbar />

      
      {children}
      <BackToTop />
    </div>
  );
}
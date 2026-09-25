import Toolbar from "@/components/Toolbar";

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="page-layout">
      <Toolbar />

      
      {children}
    </div>
  );
}
import Image from "next/image";
import Link from "next/link";



export default function Toolbar() {
  return (
    <nav className="toolbar" aria-label="Main navigation">
      <div className="toolbar-inner">
        <Link href="/" className="toolbar-brand">
          <Image
            src="/nozomlogowhite.png"
            alt="Nozom"
            width={42}
            height={42}
            className="toolbar-logo"
          />

          <span>Nozom Knowledge Bank</span>
        </Link>

        <div className="toolbar-links">
          <Link href="/">About</Link>
          <Link href="/feed">Knowledge Feed</Link>
        </div>
      </div>
    </nav>
  );
}
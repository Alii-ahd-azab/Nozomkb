"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import type { DisplayUser } from "@/lib/definitions";

type ToolbarProps = {
  user: DisplayUser | null;
};

const NAV_LINKS = [
  { href: "/", label: "About", signedInOnly: false },
  { href: "/feed", label: "Knowledge Feed", signedInOnly: false },
  { href: "/official", label: "Official Pages", signedInOnly: false },
  { href: "/search", label: "Search", signedInOnly: true },
  { href: "/bookmarks", label: "Bookmarks", signedInOnly: true },
  { href: "/profile", label: "Profile", signedInOnly: true },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // Post details belong to the Feed section.
  if (href === "/feed" && pathname.startsWith("/posts/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Toolbar({ user }: ToolbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 30);
    }

    window.addEventListener("scroll", handleScroll);

    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
   <div className="toolbar-slot">
    <nav
      className={`toolbar ${isScrolled ? "toolbar-scrolled" : ""}`}
      aria-label="Main navigation"
    >
      <div className="toolbar-inner">
        <Link href="/" className="toolbar-brand">
          <Image
            src="/nozomlogowhite.png"
            alt="Nozom"
            width={42}
            height={42}
            className="toolbar-logo"
          />

          <span className="toolbar-brand-text">
            Nozom Knowledge Bank
          </span>
        </Link>

        <div className="toolbar-links">
          {NAV_LINKS.filter((link) => user || !link.signedInOnly).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}

          {user ? (
            <div className="toolbar-user">
              <span className="toolbar-avatar" aria-hidden="true">
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="toolbar-user-name">
                {user.name}
                <small>
                  {user.role}
                  {user.departmentName ? ` · ${user.departmentName}` : ""}
                </small>
              </span>

              <form action={logout}>
                <button type="submit" className="toolbar-logout">
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              aria-current={pathname === "/login" ? "page" : undefined}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  </div>
  );
}

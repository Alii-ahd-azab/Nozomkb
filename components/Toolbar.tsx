"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { DisplayUser } from "@/lib/definitions";

type ToolbarProps = {
  user: DisplayUser | null;
};

export default function Toolbar({ user }: ToolbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);

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
          <Link href="/">About</Link>
          <Link href="/feed">Knowledge Feed</Link>
          <Link href="/official">Official Pages</Link>

          {user ? (
            <div className="toolbar-user">
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
            <Link href="/login">Sign in</Link>
          )}
        </div>
      </div>
    </nav>
  </div>
  );
}

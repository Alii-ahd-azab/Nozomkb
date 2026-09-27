"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function Toolbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 8);
    }

    window.addEventListener("scroll", handleScroll);

    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
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
        </div>
      </div>
    </nav>
  );
}
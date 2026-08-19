"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { navItems } from "@/lib/site";

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-white/88 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
          <span className="grid size-10 place-items-center rounded-full bg-brand-pink text-lg font-black text-white">
            P
          </span>
          <span>
            <span className="block text-base font-black leading-tight">Pinkkkuin</span>
            <span className="block text-xs font-semibold text-muted">小企鵝選物</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="主選單">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm font-semibold text-muted transition hover:bg-pink-50 hover:text-brand-pink-dark"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="grid size-10 place-items-center rounded-full border border-border bg-white text-foreground lg:hidden"
          aria-label={isOpen ? "關閉選單" : "開啟選單"}
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {isOpen ? (
        <nav className="border-t border-border bg-white px-4 py-3 lg:hidden" aria-label="手機選單">
          <div className="grid gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-3 text-sm font-bold text-muted hover:bg-pink-50 hover:text-brand-pink-dark"
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}

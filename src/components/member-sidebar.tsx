"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock, LogOut, ShoppingBag, User } from "lucide-react";
import { useState } from "react";

type MemberSidebarProps = {
  displayName: string;
};

const navItems = [
  { href: "/member/profile", label: "基本資料", icon: User },
  { href: "/member/orders", label: "我的訂單", icon: ShoppingBag },
  { href: "/member/account", label: "登入與安全", icon: Lock },
];

function useLogout() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    if (submitting) return;
    setSubmitting(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return { logout, submitting };
}

export function MemberSidebar({ displayName }: MemberSidebarProps) {
  const pathname = usePathname();
  const { logout, submitting } = useLogout();
  const avatarChar = displayName.trim().charAt(0) || "會";

  return (
    <>
      <aside className="hidden md:sticky md:top-6 md:flex md:flex-col md:gap-5 md:rounded-[24px] md:border-2 md:border-penguin-peach md:bg-white md:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-penguin-pink to-penguin-peach-dark text-base font-black text-white">
            {avatarChar}
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-black text-penguin-gray">{displayName}</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-bold transition ${
                  active ? "bg-penguin-pink-dark text-white" : "text-penguin-gray hover:bg-penguin-pink-light"
                }`}
              >
                <Icon size={18} className={active ? "opacity-100" : "opacity-75"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <hr className="border-penguin-peach" />

        <button
          type="button"
          onClick={logout}
          disabled={submitting}
          className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-black text-red-500 transition hover:bg-red-50 disabled:opacity-60"
        >
          <LogOut size={18} />
          {submitting ? "登出中..." : "登出"}
        </button>
      </aside>

      <nav className="nav-scrollbar mb-4 flex gap-2 overflow-x-auto md:hidden">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-shrink-0 rounded-full border-2 px-4 py-2 text-sm font-black transition ${
                active
                  ? "border-penguin-pink-dark bg-penguin-pink-dark text-white"
                  : "border-penguin-peach bg-white text-penguin-gray"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

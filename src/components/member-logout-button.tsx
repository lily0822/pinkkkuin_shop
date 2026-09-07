"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MemberLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    if (submitting) return;
    setSubmitting(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={submitting}
      className="rounded-full border-2 border-penguin-pink-dark bg-white px-5 py-2 text-sm font-black text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:opacity-60"
    >
      {submitting ? "登出中..." : "登出"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { Link2, Unlink } from "lucide-react";

type MemberLineBindingProps = {
  initialLinkedAt: string | null;
};

function dateText(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function MemberLineBinding({ initialLinkedAt }: MemberLineBindingProps) {
  const [linkedAt, setLinkedAt] = useState(initialLinkedAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isLinked = Boolean(linkedAt);

  async function unbindLine() {
    if (busy || !isLinked) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/member/line", { method: "DELETE" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "LINE 解除綁定失敗。");
      setLinkedAt(null);
      setMessage("LINE 已解除綁定。");
    } catch (unbindError) {
      setError(unbindError instanceof Error ? unbindError.message : "LINE 解除綁定失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-penguin-gray">LINE 帳號</h2>
          <p className="text-sm font-bold text-gray-500">綁定後，之後可用於會員通知與服務確認。</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${isLinked ? "bg-emerald-50 text-emerald-700" : "bg-penguin-pink-light text-penguin-pink-dark"}`}>
          {isLinked ? "LINE 已綁定" : "尚未綁定 LINE"}
        </span>
      </div>

      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-penguin-cream p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-penguin-gray">
            {isLinked ? "LINE 已綁定" : "尚未綁定 LINE"}
          </p>
          {isLinked ? (
            <p className="mt-1 text-xs font-bold text-gray-500">綁定時間：{dateText(linkedAt)}</p>
          ) : (
            <p className="mt-1 text-xs font-bold text-gray-500">點擊按鈕後會前往 LINE 完成授權。</p>
          )}
        </div>

        {isLinked ? (
          <button
            type="button"
            onClick={unbindLine}
            disabled={busy}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-full border-2 border-red-100 bg-white px-5 py-2.5 text-sm font-black text-red-500 disabled:opacity-60"
          >
            <Unlink size={16} />
            解除綁定
          </button>
        ) : (
          <form action="/api/member/line/start" method="get">
            <button
              type="submit"
              className="inline-flex w-fit items-center justify-center gap-2 rounded-full bg-[#06C755] px-5 py-2.5 text-sm font-black text-white shadow-md"
            >
              <Link2 size={16} />
              綁定 LINE
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

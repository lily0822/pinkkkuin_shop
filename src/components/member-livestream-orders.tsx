"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, Radio } from "lucide-react";

type LivestreamOrder = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  purchaseStatus: "not_bought" | "confirming" | "bought" | string;
  paymentStatus: "unpaid" | "confirming" | "paid" | string;
  photoUrl: string | null;
  createdAt: string;
};

const purchaseStatusLabel: Record<string, string> = {
  not_bought: "未購買",
  confirming: "確認中",
  bought: "已購買",
};

const paymentStatusLabel: Record<string, string> = {
  unpaid: "未付款",
  confirming: "確認中",
  paid: "已付款",
};

function money(value: number | null) {
  if (value === null || value === undefined) return "未定價";
  return `NT$${Math.round(value).toLocaleString("zh-TW")}`;
}

export type LivestreamOrdersTheme = {
  badgeBg: string;
};

export function MemberLivestreamOrders({ theme }: { theme: LivestreamOrdersTheme }) {
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(true);
  const [orders, setOrders] = useState<LivestreamOrder[]>([]);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/member/livestream-orders", { cache: "no-store" });
        const result = await response.json().catch(() => null) as
          | { ok?: boolean; linked?: boolean; orders?: LivestreamOrder[]; error?: string }
          | null;
        if (!response.ok || !result?.ok) throw new Error(result?.error || "連線下單紀錄讀取失敗。");
        if (!active) return;
        setLinked(Boolean(result.linked));
        setOrders(result.orders || []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "連線下單紀錄讀取失敗。");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function cancelOrder(orderId: string) {
    if (cancellingId) return;
    setCancellingId(orderId);
    setError("");
    try {
      const response = await fetch(`/api/member/livestream-orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "取消失敗，請稍後再試一次。");
      setOrders((current) => current.filter((order) => order.id !== orderId));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消失敗，請稍後再試一次。");
    } finally {
      setCancellingId("");
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm font-bold text-gray-400">讀取中...</p>;
  }

  if (!linked) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-penguin-pink-light/60 px-4 py-8 text-center">
        <Radio className="text-penguin-pink-dark" size={28} />
        <p className="text-sm font-bold text-penguin-gray">尚未綁定 LINE 帳號，無法查詢連線下單紀錄。</p>
        <Link
          href="/member/account"
          className="rounded-full bg-penguin-pink-dark px-5 py-2 text-sm font-black text-white shadow-md"
        >
          前往綁定
        </Link>
      </div>
    );
  }

  return (
    <div>
      {error ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      {orders.length ? (
        <div className="grid gap-3">
          {orders.map((order) => {
            const canCancel = order.purchaseStatus === "not_bought" && order.paymentStatus === "unpaid";
            return (
              <div
                key={order.id}
                className="flex items-center gap-3 rounded-2xl border-2 border-penguin-peach bg-penguin-cream px-4 py-3"
              >
                <div className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-penguin-peach bg-penguin-peach-light">
                  {order.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={order.photoUrl} alt={order.productName} className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon size={22} className="text-penguin-pink-dark" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-penguin-gray">{order.productName || "商品"}</p>
                  <p className="mt-0.5 text-xs font-bold text-gray-500">
                    數量 {order.quantity} × {money(order.unitPrice)} = {money(order.totalPrice)} ·{" "}
                    {purchaseStatusLabel[order.purchaseStatus] || order.purchaseStatus}／{paymentStatusLabel[order.paymentStatus] || order.paymentStatus}
                  </p>
                </div>
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => cancelOrder(order.id)}
                    disabled={cancellingId === order.id}
                    className="flex-shrink-0 rounded-full bg-red-100 px-3 py-1.5 text-xs font-bold text-[#111] disabled:opacity-60"
                  >
                    {cancellingId === order.id ? "取消中..." : "取消這項"}
                  </button>
                ) : (
                  <span className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-black text-[#111] ${theme.badgeBg}`}>
                    {purchaseStatusLabel[order.purchaseStatus] || order.purchaseStatus}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-penguin-pink-light/50 px-4 py-8 text-center">
          <Radio className="mx-auto text-penguin-pink-dark" size={28} />
          <p className="mt-3 text-sm font-bold text-gray-500">目前還沒有連線下單紀錄。</p>
        </div>
      )}

      <p className="mt-4 text-xs font-bold text-gray-400">僅能取消「未購買且未付款」的項目；匯款回報仍請於 LINE 對話中進行。</p>
    </div>
  );
}

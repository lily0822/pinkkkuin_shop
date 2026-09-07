"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, PackageSearch } from "lucide-react";

export type MemberOrderItem = {
  id: string;
  productName: string;
  variantSpec: string;
  productType: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type MemberOrder = {
  id: string;
  orderNo: string;
  productType: string;
  createdAt: string;
  subtotal?: number;
  shippingFee?: number;
  discountAmount?: number;
  total: number;
  status: string;
  paymentStatus: string;
  shippingStatus: string;
  items?: MemberOrderItem[];
};

type MemberOrderListProps = {
  initialOrders: MemberOrder[];
};

const orderTypeLabel: Record<string, string> = {
  stock: "現貨",
  preorder: "預購",
};

const orderStatusLabel: Record<string, string> = {
  pending: "待處理",
  processing: "處理中",
  completed: "已完成",
  cancelled: "已取消",
};

const paymentStatusLabel: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  failed: "付款失敗",
  refunded: "已退款",
};

const shippingStatusLabel: Record<string, string> = {
  pending: "待處理",
  preparing: "備貨中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
};

function money(value: number | undefined) {
  return `NT$${Math.round(Number(value || 0)).toLocaleString("zh-TW")}`;
}

function dateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function badgeClass(kind: "type" | "status" | "payment" | "shipping", value: string) {
  if (kind === "type") {
    return value === "preorder"
      ? "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100"
      : "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }
  if (value === "cancelled" || value === "failed") return "bg-rose-50 text-rose-700 ring-rose-100";
  if (value === "paid" || value === "completed" || value === "shipped") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (value === "processing" || value === "preparing") return "bg-sky-50 text-sky-700 ring-sky-100";
  return "bg-penguin-pink-light text-penguin-pink-dark ring-penguin-peach";
}

function StatusBadge({ kind, value, label }: { kind: "type" | "status" | "payment" | "shipping"; value: string; label: string }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-black ring-1 ${badgeClass(kind, value)}`}>
      {label || "-"}
    </span>
  );
}

export function MemberOrderList({ initialOrders }: MemberOrderListProps) {
  const [orders, setOrders] = useState<MemberOrder[]>(initialOrders);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState("");
  const [error, setError] = useState("");

  async function toggleOrder(order: MemberOrder) {
    setError("");
    const next = new Set(openIds);
    if (next.has(order.id)) {
      next.delete(order.id);
      setOpenIds(next);
      return;
    }

    if (!order.items) {
      setLoadingId(order.id);
      try {
        const response = await fetch(`/api/member/orders/${encodeURIComponent(order.id)}`, { cache: "no-store" });
        const result = await response.json().catch(() => null) as { ok?: boolean; order?: MemberOrder; error?: string } | null;
        if (!response.ok || !result?.ok || !result.order) throw new Error(result?.error || "訂單明細讀取失敗。");
        setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...result.order } : item));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "訂單明細讀取失敗。");
        setLoadingId("");
        return;
      } finally {
        setLoadingId("");
      }
    }

    next.add(order.id);
    setOpenIds(next);
  }

  return (
    <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-penguin-gray">我的訂單</h2>
          <p className="text-sm font-bold text-gray-500">只顯示登入會員帳號建立的訂單。</p>
        </div>
        <span className="w-fit rounded-full bg-penguin-yellow px-3 py-1 text-xs font-black text-penguin-gray">
          {orders.length} 筆
        </span>
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      <div className="mt-5 space-y-3">
        {orders.length ? orders.map((order) => {
          const isOpen = openIds.has(order.id);
          const items = order.items || [];
          return (
            <article key={order.id} className="rounded-2xl border border-penguin-peach bg-white p-4">
              <button
                type="button"
                onClick={() => toggleOrder(order)}
                className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-penguin-gray">{order.orderNo}</p>
                    <StatusBadge kind="type" value={order.productType} label={orderTypeLabel[order.productType] || order.productType} />
                  </div>
                  <p className="mt-1 text-xs font-bold text-gray-500">{dateText(order.createdAt)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-black text-penguin-gray sm:flex sm:items-center">
                  <StatusBadge kind="status" value={order.status} label={orderStatusLabel[order.status] || order.status} />
                  <StatusBadge kind="payment" value={order.paymentStatus} label={paymentStatusLabel[order.paymentStatus] || order.paymentStatus} />
                  <StatusBadge kind="shipping" value={order.shippingStatus} label={shippingStatusLabel[order.shippingStatus] || order.shippingStatus} />
                  <span className="text-sm font-black text-penguin-pink-dark">{money(order.total)}</span>
                  {loadingId === order.id ? (
                    <span className="text-xs text-gray-400">讀取中</span>
                  ) : isOpen ? (
                    <ChevronUp size={18} className="text-penguin-pink-dark" />
                  ) : (
                    <ChevronDown size={18} className="text-penguin-pink-dark" />
                  )}
                </div>
              </button>

              {isOpen ? (
                <div className="mt-4 border-t border-dashed border-penguin-peach pt-4">
                  <div className="space-y-3">
                    {items.length ? items.map((item) => (
                      <div key={item.id} className="flex flex-col gap-1 rounded-2xl bg-penguin-cream px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-black text-penguin-gray">
                            {item.productName}
                            {item.variantSpec ? <span className="text-gray-500">（{item.variantSpec}）</span> : null}
                          </p>
                          <p className="mt-1 text-xs font-bold text-gray-500">
                            {(orderTypeLabel[item.productType] || item.productType || "商品")} · {money(item.unitPrice)} × {item.quantity}
                          </p>
                        </div>
                        <p className="font-black text-penguin-pink-dark">{money(item.subtotal)}</p>
                      </div>
                    )) : (
                      <p className="rounded-2xl bg-penguin-pink-light/50 px-4 py-4 text-center text-sm font-bold text-gray-500">目前沒有商品明細。</p>
                    )}
                  </div>
                  <dl className="mt-4 grid gap-2 text-sm font-bold text-penguin-gray sm:max-w-xs sm:ml-auto">
                    <div className="flex justify-between"><dt>商品小計</dt><dd>{money(order.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt>運費</dt><dd>{money(order.shippingFee)}</dd></div>
                    <div className="flex justify-between"><dt>優惠</dt><dd>-{money(order.discountAmount)}</dd></div>
                    <div className="flex justify-between border-t border-penguin-peach pt-2 text-base font-black text-penguin-pink-dark"><dt>總計</dt><dd>{money(order.total)}</dd></div>
                  </dl>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <div className="rounded-2xl bg-penguin-pink-light/50 px-4 py-8 text-center">
            <PackageSearch className="mx-auto text-penguin-pink-dark" size={30} />
            <p className="mt-3 text-sm font-bold text-gray-500">目前還沒有會員訂單。</p>
          </div>
        )}
      </div>
    </section>
  );
}

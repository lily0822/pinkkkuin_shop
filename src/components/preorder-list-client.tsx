"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Minus, Plus, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/products";

type PreorderListItem = {
  id: string;
  productId: string;
  productName: string;
  variantSpec: string | null;
  seriesName: string | null;
  image: string;
  quantity: number;
  unitPrice: number;
  createdAt: string;
};

type LoadState = "loading" | "ready" | "unauthorized" | "error";

export function PreorderListClient() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<PreorderListItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<{ orderNo: string; total: number } | null>(null);

  async function loadItems() {
    setState("loading");
    try {
      const response = await fetch("/api/member/preorder-list");
      if (response.status === 401) {
        setState("unauthorized");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setState("error");
        return;
      }
      setItems(result.items || []);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems();
  }, []);

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity < 1) return;
    const previous = items;
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, quantity } : item)));
    try {
      const response = await fetch(`/api/member/preorder-list/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      if (!response.ok) setItems(previous);
    } catch {
      setItems(previous);
    }
  }

  async function removeItem(itemId: string) {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== itemId));
    try {
      const response = await fetch(`/api/member/preorder-list/${itemId}`, { method: "DELETE" });
      if (!response.ok) setItems(previous);
    } catch {
      setItems(previous);
    }
  }

  async function submitRegistration() {
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/member/preorder-list/submit", { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setSubmitError(result?.error || "預購登記失敗，請稍後再試。");
        return;
      }
      setSubmitResult({ orderNo: result.order?.orderNo || "", total: Number(result.order?.total || 0) });
      setItems([]);
    } catch {
      setSubmitError("預購登記失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-center text-sm font-bold text-gray-400">載入中...</p>
      </main>
    );
  }

  if (state === "unauthorized") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark">
            <ClipboardList size={27} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-penguin-gray">請先登入會員</h1>
          <p className="mt-2 text-sm font-bold text-gray-500">登入後才能查看你的預購清單。</p>
          <Link href="/login?next=/preorder-list" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink">
            前往登入
          </Link>
        </section>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm sm:p-12">
          <p className="text-sm font-bold text-gray-500">預購清單讀取失敗，請重新整理頁面再試一次。</p>
        </section>
      </main>
    );
  }

  if (submitResult) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <ClipboardList size={27} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-penguin-gray">預購登記成功</h1>
          <p className="mt-2 text-sm font-bold text-gray-500">
            訂單編號 <span className="font-black text-penguin-gray">{submitResult.orderNo}</span>，總金額 {formatPrice(submitResult.total)}
          </p>
          <p className="mt-1 text-xs font-bold text-gray-400">我們之後會另外跟你確認收件與付款資訊。</p>
          <Link href="/member/orders" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink">
            查看我的訂單
          </Link>
        </section>
      </main>
    );
  }

  if (!items.length) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark">
            <ClipboardList size={27} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-penguin-gray">預購清單是空的</h1>
          <p className="mt-2 text-sm font-bold text-gray-500">先去挑選想預購的商品，加入清單後再回來送出登記。</p>
          <Link href="/category/preorder" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink">
            前往預購頁面
          </Link>
        </section>
      </main>
    );
  }

  const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-xs font-black text-penguin-pink-dark">預購流程</p>
        <h1 className="mt-1 text-3xl font-black text-penguin-gray sm:text-4xl">預購清單</h1>
        <p className="mt-2 text-sm font-bold text-gray-500">確認商品、規格與數量後，送出預購登記。</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-3xl border-2 border-penguin-peach bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-penguin-peach bg-penguin-cream/55 px-4 py-3 sm:px-5">
            <span className="text-sm font-black text-penguin-gray">預購清單</span>
            <span className="text-xs font-bold text-gray-400">共 {items.length} 項商品</span>
          </div>
          {items.map((item, index) => (
            <article key={item.id} className={`p-4 sm:p-5 ${index ? "border-t border-dashed border-penguin-peach" : ""}`}>
              <div className="flex min-w-0 gap-3 sm:gap-4">
                <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-penguin-pink-light text-xl font-black text-penguin-pink-dark sm:h-24 sm:w-24">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                  ) : "P"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-black leading-5 text-penguin-gray sm:text-base">{item.productName}</h2>
                      {item.variantSpec ? <p className="mt-1 text-xs font-black text-penguin-pink-dark">規格：{item.variantSpec}</p> : null}
                      {item.seriesName ? <p className="mt-0.5 text-xs font-bold text-gray-400">系列：{item.seriesName}</p> : null}
                    </div>
                    <button type="button" onClick={() => removeItem(item.id)} aria-label={`移除 ${item.productName}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-penguin-pink-light/60 text-gray-400 transition hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-1 text-xs font-bold text-gray-500 sm:grid-cols-2 sm:gap-3">
                    <p>單價 <span className="font-black text-penguin-gray">{formatPrice(item.unitPrice)}</span></p>
                    <p className="sm:text-right">小計 <span className="font-black text-penguin-pink-dark">{formatPrice(item.unitPrice * item.quantity)}</span></p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 pl-0 sm:pl-0">
                <div className="inline-flex h-10 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                  <button type="button" disabled={item.quantity <= 1} onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label={`減少 ${item.productName} 數量`} className="grid h-full w-10 place-items-center text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:text-gray-300">
                    <Minus size={15} />
                  </button>
                  <span className="min-w-10 text-center text-sm font-black text-penguin-gray">{item.quantity}</span>
                  <button type="button" onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label={`增加 ${item.productName} 數量`} className="grid h-full w-10 place-items-center text-penguin-pink-dark transition hover:bg-penguin-pink-light">
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black text-penguin-gray">預購摘要</h2>
            <div className="mt-5 space-y-3 border-b border-penguin-peach pb-4 text-sm font-bold text-gray-500">
              <div className="flex justify-between gap-4">
                <span>商品總額</span>
                <span className="font-black text-penguin-gray">{formatPrice(total)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>商品數量</span>
                <span>{totalQuantity} 件</span>
              </div>
            </div>

            {submitError ? <p className="mt-4 rounded-2xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">{submitError}</p> : null}

            <button
              type="button"
              onClick={submitRegistration}
              disabled={submitting}
              className="mt-5 block w-full rounded-full bg-penguin-pink-dark py-3 text-center text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:opacity-60"
            >
              {submitting ? "送出中..." : "送出預購清單"}
            </button>
            <Link href="/category/preorder" className="mt-3 flex items-center justify-center text-sm font-black text-gray-500 transition hover:text-penguin-pink-dark">
              繼續選購預購商品
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft, Minus, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { formatPrice } from "@/lib/products";

export function CartConfirmationClient() {
  const {
    items,
    selectedLineCount,
    selectedQuantity,
    selectedTotal,
    updateQuantity,
    removeItem,
    toggleItemSelected,
    openCart,
  } = useCart();

  if (!items.length) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark">
            <ShoppingBasket size={27} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-penguin-gray">購物車是空的</h1>
          <p className="mt-2 text-sm font-bold text-gray-500">先挑選喜歡的商品，再回來確認購物車。</p>
          <Link href="/products" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink">
            前往商品列表
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-xs font-black text-penguin-pink-dark">結帳流程</p>
        <h1 className="mt-1 text-3xl font-black text-penguin-gray sm:text-4xl">購物車確認</h1>
        <p className="mt-2 text-sm font-bold text-gray-500">確認商品、規格與數量後，再前往填寫結帳資料。</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-3xl border-2 border-penguin-peach bg-white shadow-sm">
          {items.map((item, index) => {
            const atMaximum = item.maxQuantity !== null && item.maxQuantity !== undefined && item.quantity >= item.maxQuantity;
            return (
              <article key={item.id} className={`p-4 sm:p-5 ${index ? "border-t border-dashed border-penguin-peach" : ""} ${item.selected === false ? "bg-gray-50/70" : ""}`}>
                <div className="flex min-w-0 gap-3 sm:gap-4">
                  <label className="mt-8 flex shrink-0 cursor-pointer items-start" title="選擇本次結帳商品">
                    <input
                      type="checkbox"
                      checked={item.selected !== false}
                      onChange={(event) => toggleItemSelected(item.id, event.target.checked)}
                      className="h-4 w-4 accent-penguin-pink-dark"
                      aria-label={`選擇 ${item.productName}`}
                    />
                  </label>
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
                        <p className="mt-1 text-xs font-bold text-gray-500">{item.productType}</p>
                        {item.variantSpec ? <p className="mt-1 text-xs font-black text-penguin-pink-dark">規格：{item.variantSpec}</p> : null}
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pl-7 sm:pl-8">
                  <div className="inline-flex h-10 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                    <button type="button" disabled={item.quantity <= 1} onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label={`減少 ${item.productName} 數量`} className="grid h-full w-10 place-items-center text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:text-gray-300">
                      <Minus size={15} />
                    </button>
                    <span className="min-w-10 text-center text-sm font-black text-penguin-gray">{item.quantity}</span>
                    <button type="button" disabled={atMaximum} onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label={`增加 ${item.productName} 數量`} className="grid h-full w-10 place-items-center text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:text-gray-300">
                      <Plus size={15} />
                    </button>
                  </div>
                  {item.maxQuantity !== null && item.maxQuantity !== undefined ? <p className="text-[11px] font-bold text-gray-400">最多 {item.maxQuantity} 件</p> : null}
                </div>
              </article>
            );
          })}
        </section>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black text-penguin-gray">訂單摘要</h2>
            <div className="mt-5 space-y-3 border-b border-penguin-peach pb-4 text-sm font-bold text-gray-500">
              <div className="flex justify-between gap-4">
                <span>商品總額</span>
                <span className="font-black text-penguin-gray">{formatPrice(selectedTotal)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>本次商品</span>
                <span>{selectedQuantity} 件</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>運費</span>
                <span className="text-right text-xs">於下一步計算</span>
              </div>
            </div>

            {!selectedLineCount ? <p className="mt-4 rounded-2xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">請至少選擇一件要結帳的商品。</p> : null}

            <Link href="/checkout" aria-disabled={!selectedLineCount} className={`mt-5 block rounded-full py-3 text-center text-sm font-black shadow-md transition ${selectedLineCount ? "bg-penguin-pink-dark text-white hover:bg-penguin-pink" : "pointer-events-none bg-gray-200 text-gray-400"}`}>
              前往結帳
            </Link>
            <button type="button" onClick={openCart} className="mt-3 w-full rounded-full border-2 border-penguin-pink py-2.5 text-sm font-black text-penguin-pink-dark transition hover:bg-penguin-pink-light">
              返回購物車
            </button>
            <Link href="/products" className="mt-3 flex items-center justify-center gap-2 text-sm font-black text-gray-500 transition hover:text-penguin-pink-dark">
              <ArrowLeft size={15} />
              繼續購物
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}

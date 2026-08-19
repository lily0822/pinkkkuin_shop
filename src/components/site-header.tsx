"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Menu, Search, ShoppingBasket, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { navItems } from "@/lib/site";

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const cart = useCart();

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : "/products");
    setIsOpen(false);
  }

  return (
    <>
      <div className="relative flex items-center justify-center gap-2 overflow-hidden bg-gradient-to-r from-penguin-pink to-penguin-yellow px-4 py-2 text-center text-xs font-bold tracking-wide text-penguin-gray md:text-sm">
        <span className="inline-block animate-bounce">✦</span>
        <span>【東京夏日限定連線中】全館滿 NT$1,100 即享超商免運，企鵝在日本現場幫你搶貨！</span>
        <span className="inline-block animate-bounce">✦</span>
      </div>

      <header className="sticky top-0 z-40 border-b-4 border-penguin-pink bg-white/95 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="group flex items-center gap-2" onClick={() => setIsOpen(false)}>
            <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-penguin-yellow text-2xl shadow-sm transition-transform group-hover:scale-110">
              🐧
            </span>
            <span>
              <span className="flex items-center gap-2 text-xl font-black tracking-tight text-penguin-pink-dark md:text-2xl">
                小企鵝選物
                <span className="rounded-full border border-yellow-400 bg-penguin-yellow px-2 py-0.5 text-xs text-penguin-gray">
                  日本代購
                </span>
              </span>
              <span className="block text-[10px] tracking-wider text-gray-400">KOPENGUIN SELECT SHOP</span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="order-3 w-full flex-1 md:order-none md:max-w-md">
            <label className="relative block">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋日本限定、美妝、角落生物..."
                className="w-full rounded-full border-2 border-penguin-pink bg-penguin-cream py-1.5 pl-4 pr-10 text-sm outline-none transition focus:border-penguin-pink-dark"
              />
              <button
                type="submit"
                aria-label="搜尋商品"
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-penguin-pink-dark"
              >
                <Search size={17} />
              </button>
            </label>
          </form>

          <div className="flex items-center gap-2">
            <Link
              href="/contact"
              className="hidden items-center gap-1 rounded-full border-2 border-yellow-400 bg-penguin-yellow px-3.5 py-1.5 text-xs font-bold text-penguin-gray shadow-sm transition hover:bg-yellow-200 md:flex"
            >
              <Heart size={15} />
              幫我找
            </Link>
            <button
              type="button"
              onClick={cart.openCart}
              className="relative flex items-center gap-2 rounded-full border-2 border-penguin-pink-dark bg-penguin-pink px-4 py-2 text-xs font-bold text-penguin-gray shadow-sm transition hover:-translate-y-0.5 hover:bg-penguin-pink-light md:text-sm"
            >
              <ShoppingBasket size={17} />
              選物箱
              <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] text-white">
                {cart.count}
              </span>
            </button>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full border-2 border-penguin-pink bg-white text-penguin-gray lg:hidden"
              aria-label={isOpen ? "關閉選單" : "開啟選單"}
              onClick={() => setIsOpen((value) => !value)}
            >
              {isOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        <nav className={`${isOpen ? "block" : "hidden"} border-t border-penguin-pink bg-penguin-pink-light/70 lg:block lg:border-t-0`}>
          <div className="nav-scrollbar mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2 text-sm font-bold">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="category-tab shrink-0 snap-start"
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
    </>
  );
}

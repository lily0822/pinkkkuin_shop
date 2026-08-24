"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, Menu, Search, ShoppingBasket, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { type SiteAnnouncement, type SiteNavigationItem } from "@/lib/appearance-settings";
import { cloudinaryTransform, type BrandSettings } from "@/lib/brand-settings";

type SiteHeaderClientProps = {
  brand: BrandSettings;
  announcements?: SiteAnnouncement[];
  navigationItems?: SiteNavigationItem[];
};

const FALLBACK_NAVIGATION_ITEMS: SiteNavigationItem[] = [
  { key: "home", label: "首頁", href: "/", enabled: true, locked: true, sortOrder: 0 },
  { key: "products", label: "全部商品", href: "/products", enabled: true, sortOrder: 1 },
  { key: "preorder", label: "預購商品", href: "/category/preorder", enabled: true, sortOrder: 2 },
  { key: "stock", label: "現貨", href: "/category/in_stock", enabled: true, sortOrder: 3 },
  { key: "live_order", label: "連線 / 擺攤", href: "/category/live_order", enabled: true, sortOrder: 4 },
  { key: "guide", label: "購物須知", href: "/guide", enabled: true, sortOrder: 5 },
  { key: "faq", label: "FAQ", href: "/faq", enabled: true, sortOrder: 6 },
  { key: "contact", label: "聯絡小企鵝", href: "/contact", enabled: true, sortOrder: 7 },
];

function AnnouncementItem({ announcement }: { announcement: SiteAnnouncement }) {
  const content = (
    <span className="mx-8 inline-flex items-center gap-3 whitespace-nowrap">
      <span className="text-penguin-pink-dark">✦</span>
      <span>{announcement.text}</span>
      <span className="text-penguin-pink-dark">✦</span>
    </span>
  );
  return announcement.href ? (
    <Link href={announcement.href} className="underline decoration-penguin-pink-dark decoration-2 underline-offset-4">
      {content}
    </Link>
  ) : (
    content
  );
}

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  const [pathname] = path.split(/[?#]/);
  return pathname.replace(/\/+$/, "") || "/";
}

function isNavigationItemActive(item: SiteNavigationItem, pathname: string) {
  const itemPath = normalizePath(item.href);
  const currentPath = normalizePath(pathname);

  if (itemPath === "/") return currentPath === "/";
  if (itemPath === "/products") return currentPath === "/products" || currentPath.startsWith("/products/");
  if (currentPath === itemPath) return true;

  return itemPath.startsWith("/category/") && currentPath.startsWith(`${itemPath}/`);
}

export function SiteHeaderClient({ brand, announcements = [], navigationItems = FALLBACK_NAVIGATION_ITEMS }: SiteHeaderClientProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCart();
  const logoUrl = brand.logoUrl ? cloudinaryTransform(brand.logoUrl, "f_auto,q_auto,w_240,c_limit") : "";
  const logoScale = Math.min(3, Math.max(1, Number(brand.logoScale) || 1));
  const logoPositionX = Math.min(100, Math.max(-100, Number(brand.logoPositionX) || 0));
  const logoPositionY = Math.min(100, Math.max(-100, Number(brand.logoPositionY) || 0));
  const headerActionButtonBase = "relative h-9 min-h-9 w-[92px] min-w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-full border-2 p-0 font-sans text-xs font-bold leading-none tracking-normal shadow-sm transition";
  const headerActionTextClass = "block text-[12px] font-bold leading-none tracking-normal";
  const headerActionTextStyle = {
    fontFamily: "var(--font-noto-tc), 'Microsoft JhengHei', ui-sans-serif, system-ui, sans-serif",
  };
  const helpButtonVariant = "border-yellow-400 bg-penguin-yellow text-penguin-gray hover:bg-yellow-200";
  const cartButtonVariant = "border-penguin-pink-dark bg-penguin-pink text-penguin-gray hover:-translate-y-0.5 hover:bg-penguin-pink-light";
  const visibleAnnouncements = announcements.filter((item) => item.enabled && item.text);
  const showAnnouncement = visibleAnnouncements.length > 0;
  const visibleNavigationItems = navigationItems.filter((item) => item.enabled);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : "/products");
    setIsOpen(false);
  }

  return (
    <>
      {showAnnouncement ? (
        <div className="relative h-9 overflow-hidden bg-gradient-to-r from-penguin-pink to-penguin-yellow text-xs font-bold tracking-wide text-penguin-gray md:text-sm">
          <div className="announcement-marquee flex h-full w-max items-center whitespace-nowrap hover:[animation-play-state:paused] motion-reduce:animate-none">
            <span className="flex items-center">
              {visibleAnnouncements.map((item, index) => (
                <AnnouncementItem key={`${item.id || item.text}-${index}`} announcement={item} />
              ))}
            </span>
            {visibleAnnouncements.length > 1 ? (
              <span className="flex items-center" aria-hidden="true">
                {visibleAnnouncements.map((item, index) => (
                  <AnnouncementItem key={`loop-${item.id || item.text}-${index}`} announcement={item} />
                ))}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b-4 border-penguin-pink bg-white/95 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="group flex items-center gap-2" onClick={() => setIsOpen(false)}>
            <span className="grid h-14 w-14 place-items-center overflow-hidden bg-transparent text-2xl transition-transform group-hover:scale-105">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${brand.storeName} LOGO`}
                  className="h-full w-full object-contain object-center"
                  style={{
                    transform: `translate(${logoPositionX}%, ${logoPositionY}%) scale(${logoScale})`,
                    transformOrigin: "center",
                  }}
                />
              ) : (
                "P"
              )}
            </span>
            <span>
              <span className="flex items-center gap-2 text-xl font-black tracking-tight text-penguin-pink-dark md:text-2xl">
                {brand.storeName}
                <span className="rounded-full border border-yellow-400 bg-penguin-yellow px-2 py-0.5 text-xs text-penguin-gray">
                  日本選物
                </span>
              </span>
              <span className="block text-[10px] tracking-wider text-gray-400">{brand.storeNameEn}</span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="order-3 w-full flex-1 md:order-none md:max-w-md">
            <label className="relative block">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋商品、角色或分類..."
                className="w-full rounded-full border-2 border-penguin-pink bg-penguin-cream py-1.5 pl-4 pr-10 text-sm outline-none transition focus:border-penguin-pink-dark"
              />
              <button
                type="submit"
                aria-label="搜尋"
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-penguin-pink-dark"
              >
                <Search size={17} />
              </button>
            </label>
          </form>

          <div className="flex items-center gap-2">
            <Link href="/contact" className={`hidden md:flex ${headerActionButtonBase} ${helpButtonVariant}`}>
              <Heart size={15} strokeWidth={2} />
              <span className={headerActionTextClass} style={headerActionTextStyle}>
                幫我找
              </span>
            </Link>
            <button type="button" onClick={cart.openCart} className={`flex ${headerActionButtonBase} ${cartButtonVariant}`}>
              <ShoppingBasket size={15} strokeWidth={2} />
              <span className={headerActionTextClass} style={headerActionTextStyle}>
                購物車
              </span>
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
            {visibleNavigationItems.map((item) => {
              const isActive = isNavigationItemActive(item, pathname);
              return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`category-tab shrink-0 snap-start ${isActive ? "active" : ""}`}
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </Link>
              );
            })}
          </div>
        </nav>
      </header>
    </>
  );
}

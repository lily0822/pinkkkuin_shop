"use client";

import Link from "next/link";
import { Eye, ShoppingBasket } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { ProductArt } from "@/components/product-art";
import { formatPrice, Product, statusLabels, statusStyles } from "@/lib/products";

type ProductCardProps = {
  product: Product;
  onQuickView?: (product: Product) => void;
  compact?: boolean;
};

function normalizeTagColor(color?: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? (color as string) : "#ec4899";
}

function readableTagText(color?: string) {
  const hex = normalizeTagColor(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72 ? "#334155" : normalizeTagColor(color);
}

function tagStyle(color?: string) {
  const safeColor = normalizeTagColor(color);
  return {
    backgroundColor: `${safeColor}22`,
    borderColor: `${safeColor}66`,
    color: readableTagText(safeColor),
  };
}

export function ProductCard({ product, onQuickView, compact = false }: ProductCardProps) {
  const cart = useCart();
  const canOrder = product.status !== "sold_out" && product.status !== "hidden";
  const allTags = (product.tags || []).filter((tag) => tag.enabled !== false);
  const categoryTags = allTags.filter((tag) => tag.type === "category");
  const visibleTags = allTags.length
    ? allTags
    : product.category
      ? [{ id: `category:${product.category}`, name: product.category, type: "category" as const, enabled: true, sortOrder: 0, color: "#facc15" }]
      : [];

  if (compact) {
    return (
      <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-penguin-peach bg-white p-1.5 shadow-sm transition hover:-translate-y-0.5 hover:border-penguin-pink hover:shadow-md">
        <Link href={`/products/${product.id}`} className="block">
          <ProductArt image={product.images[0]} name={product.name_zh} width={420} />
        </Link>
        <div className="flex flex-1 flex-col gap-2 px-1.5 py-2">
          <div className="flex flex-wrap gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusStyles[product.status]}`}>
              {statusLabels[product.status]}
            </span>
            {visibleTags.map((tag) => (
              <span
                key={`${tag.type}:${tag.id}`}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-black leading-none"
                style={tagStyle(tag.color)}
              >
                {tag.name}
              </span>
            ))}
          </div>
          <Link href={`/products/${product.id}`} className="block">
            <h3 className="line-clamp-2 min-h-[38px] text-[13px] font-black leading-[19px] text-penguin-gray">
              {product.name_zh}
            </h3>
          </Link>
          <div className="mt-auto flex items-end justify-between gap-2">
            <p className="text-base font-black text-penguin-pink-dark">{formatPrice(product.price)}</p>
            <p className="text-[10px] font-bold text-gray-400">{canOrder ? "可詢問" : "售完"}</p>
          </div>
          <div className="grid grid-cols-[34px_1fr] gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-xl border border-penguin-peach bg-white text-penguin-gray transition hover:border-penguin-pink"
              onClick={() => onQuickView?.(product)}
              aria-label="快速查看商品"
            >
              <Eye size={14} />
            </button>
            <button
              type="button"
              disabled={!canOrder}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-penguin-pink-dark bg-penguin-pink px-2 text-[11px] font-black text-penguin-gray transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
              onClick={() => cart.addProduct(product)}
            >
              <ShoppingBasket size={13} />
              加入購物車
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group overflow-hidden rounded-3xl border-2 border-penguin-peach bg-white p-2 shadow-md transition hover:-translate-y-1 hover:border-penguin-pink hover:shadow-xl">
      <Link href={`/products/${product.id}`} className="block">
        <ProductArt image={product.images[0]} name={product.name_zh} />
      </Link>
      <div className="space-y-2.5 px-2 py-3">
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusStyles[product.status]}`}>
            {statusLabels[product.status]}
          </span>
          {(categoryTags.length ? allTags : visibleTags).map((tag) => (
            <span
              key={`${tag.type}:${tag.id}`}
              className="rounded-full border px-2.5 py-1 text-[11px] font-black"
              style={tagStyle(tag.color)}
            >
              {tag.name}
            </span>
          ))}
        </div>
        <Link href={`/products/${product.id}`} className="block">
          <h3 className="line-clamp-2 min-h-[44px] text-sm font-black leading-6 text-penguin-gray">
            {product.name_zh}
          </h3>
        </Link>
        <div className="flex items-end justify-between gap-2">
          <p className="text-lg font-black text-penguin-pink-dark">{formatPrice(product.price)}</p>
          <p className="text-[11px] font-bold text-gray-400">{canOrder ? "可以詢問" : "暫不可購買"}</p>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl border-2 border-penguin-peach bg-white px-3 text-xs font-black text-penguin-gray transition hover:border-penguin-pink"
            onClick={() => onQuickView?.(product)}
            aria-label="快速查看商品"
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            disabled={!canOrder}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border-2 border-penguin-pink-dark bg-penguin-pink text-xs font-black text-penguin-gray transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
            onClick={() => cart.addProduct(product)}
          >
            <ShoppingBasket size={15} />
            加入選物箱
          </button>
        </div>
      </div>
    </article>
  );
}

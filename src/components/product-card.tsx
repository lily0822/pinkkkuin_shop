"use client";

import Link from "next/link";
import { Eye, ShoppingBasket } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { ProductArt } from "@/components/product-art";
import { formatPrice, Product, statusLabels, statusStyles } from "@/lib/products";

type ProductCardProps = {
  product: Product;
  onQuickView?: (product: Product) => void;
};

export function ProductCard({ product, onQuickView }: ProductCardProps) {
  const cart = useCart();
  const canOrder = product.status !== "sold_out" && product.status !== "hidden";

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
          <span className="rounded-full bg-penguin-yellow px-2.5 py-1 text-[11px] font-black text-penguin-gray">
            {product.category}
          </span>
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

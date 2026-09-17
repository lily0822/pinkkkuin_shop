"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, variantStock } from "@/components/cart-provider";
import { ProductArt } from "@/components/product-art";
import { formatPrice, Product } from "@/lib/products";

type ProductCardProps = {
  product: Product;
  onQuickView?: (product: Product) => void;
  compact?: boolean;
};

export function ProductCard({ product }: ProductCardProps) {
  const cart = useCart();
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const hasMultipleVariants = (product.variants || []).length > 1;
  const singleVariant = product.variants?.length === 1 ? product.variants[0] : null;
  const maxQuantity = variantStock(product, singleVariant);
  const canOrder = product.status !== "sold_out" && product.status !== "hidden"
    && (!singleVariant || singleVariant.status === "active")
    && (hasMultipleVariants || maxQuantity === null || maxQuantity > 0);
  const selectedQuantity = maxQuantity === null ? quantity : Math.max(1, Math.min(quantity, maxQuantity));
  const cartLabel = hasMultipleVariants ? "選擇規格" : "加入購物車";

  function handleCartClick() {
    if (!canOrder) return;
    if (hasMultipleVariants) {
      router.push(`/products/${product.id}`);
      return;
    }
    const added = cart.addProduct(product, singleVariant, selectedQuantity);
    setMessage(added ? "" : "已達可購買數量，請確認購物車。");
  }

  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-penguin-peach bg-white p-1 shadow-sm sm:p-1.5">
      <Link href={`/products/${product.id}`} className="relative block">
        <ProductArt image={product.images[0]} name={product.name_zh} width={600} />
        <span className="absolute left-1.5 top-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold text-penguin-pink-dark sm:left-2 sm:top-2 sm:px-3 sm:py-1 sm:text-xs">
          {product.status === "preorder" || product.category === "預購商品" ? "預購" : "現貨"}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-1.5 py-2 sm:gap-2 sm:px-2 sm:py-2.5">
        <Link href={`/products/${product.id}`} className="block">
          <h3 className="line-clamp-2 min-h-8 break-words text-xs font-bold leading-4 text-penguin-gray sm:min-h-10 sm:text-sm sm:leading-5">{product.name_zh}</h3>
        </Link>
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap sm:gap-1.5">
          <p className="min-w-0 basis-full break-words text-xs font-black leading-tight text-penguin-pink-dark sm:flex-1 sm:basis-auto sm:text-sm">{formatPrice(singleVariant?.price ?? product.price)}</p>
          <div role="group" aria-label={`${product.name_zh} 數量${hasMultipleVariants ? "（請先選擇規格）" : ""}`} className="ml-auto flex h-7 shrink-0 items-center rounded-lg border border-penguin-peach sm:ml-0 sm:h-8">
            <button type="button" aria-label="減少數量" disabled={!canOrder || hasMultipleVariants || selectedQuantity <= 1} onClick={() => setQuantity(selectedQuantity - 1)} className="h-full w-6 rounded-l-lg disabled:text-gray-300 sm:w-7">−</button>
            <output className="min-w-4 text-center text-xs tabular-nums sm:min-w-5">{selectedQuantity}</output>
            <button type="button" aria-label="增加數量" disabled={!canOrder || hasMultipleVariants || (maxQuantity !== null && selectedQuantity >= maxQuantity)} onClick={() => setQuantity(selectedQuantity + 1)} className="h-full w-6 rounded-r-lg disabled:text-gray-300 sm:w-7">+</button>
          </div>
          <button type="button" aria-label={`${cartLabel}：${product.name_zh}`} title={cartLabel} disabled={!canOrder} onClick={handleCartClick} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-penguin-pink text-penguin-gray transition hover:bg-penguin-pink-light disabled:bg-stone-100 disabled:text-stone-400 sm:h-8 sm:w-8">
            <ShoppingCart size={17} />
          </button>
        </div>
        {message ? <p role="status" className="text-xs text-penguin-pink-dark">{message}</p> : null}
      </div>
    </article>
  );
}

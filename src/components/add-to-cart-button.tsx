"use client";

import { ShoppingBasket } from "lucide-react";
import { useMemo, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { formatPrice, Product, ProductVariant } from "@/lib/products";

type AddToCartButtonProps = {
  product: Product;
};

function isVariantAvailable(variant: ProductVariant) {
  return variant.status === "active" && Number(variant.stockQuantity ?? 0) > 0;
}

function variantDisplayPrice(product: Product, variant: ProductVariant | null) {
  return Number(variant?.price ?? product.price ?? 0);
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { addProduct, openCart } = useCart();
  const variants = useMemo(() => (product.variants || []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [product.variants]);
  const purchasableVariants = variants.filter(isVariantAvailable);
  const hasMultipleVariants = variants.length > 1;
  const onlyVariant = variants.length === 1 ? variants[0] : null;
  const [selectedVariantId, setSelectedVariantId] = useState<string>(onlyVariant?.id || "");
  const [message, setMessage] = useState("");
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) || onlyVariant;
  const disabledProduct = product.status === "sold_out" || product.status === "hidden";
  const selectedUnavailable = selectedVariant ? !isVariantAvailable(selectedVariant) : false;
  const needsVariant = hasMultipleVariants && !selectedVariant;
  const price = variantDisplayPrice(product, selectedVariant || null);

  function handleAdd() {
    if (disabledProduct) return;
    if (needsVariant) {
      setMessage("請先選擇規格");
      return;
    }
    if (selectedUnavailable) {
      setMessage("這個規格已售完");
      return;
    }
    const added = addProduct(product, selectedVariant || null);
    setMessage(added ? "" : "已達可購買數量上限");
    if (added) openCart();
  }

  return (
    <div className="space-y-4 rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-penguin-pink-dark">Price</p>
          <p className="mt-1 text-3xl font-black text-penguin-pink-dark">{formatPrice(price)}</p>
        </div>
        {selectedVariant?.stockQuantity != null ? (
          <p className="rounded-full bg-penguin-cream px-3 py-1 text-xs font-black text-gray-500">
            可購買 {selectedVariant.stockQuantity} 件
          </p>
        ) : null}
      </div>

      {variants.length ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-black text-penguin-gray">規格</h2>
            {hasMultipleVariants ? <span className="text-xs font-bold text-gray-400">請選擇一個規格</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const selected = selectedVariantId === variant.id || (!selectedVariantId && onlyVariant?.id === variant.id);
              const available = isVariantAvailable(variant);
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    setSelectedVariantId(variant.id);
                    setMessage("");
                  }}
                  className={`inline-flex min-h-11 items-center justify-center rounded-full border-2 px-4 py-2 text-sm font-black transition ${
                    selected
                      ? "border-penguin-pink-dark bg-penguin-pink text-penguin-gray shadow-sm"
                      : "border-penguin-peach bg-white text-penguin-gray hover:border-penguin-pink"
                  } disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400`}
                >
                  {variant.spec}
                  {!available ? <span className="ml-2 text-[11px]">售完</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabledProduct || selectedUnavailable || (!purchasableVariants.length && variants.length > 0)}
        onClick={handleAdd}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-penguin-pink-dark px-5 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        <ShoppingBasket size={17} />
        {disabledProduct || selectedUnavailable || (!purchasableVariants.length && variants.length > 0) ? "暫時無法購買" : "加入購物車"}
      </button>

      {message ? <p className="text-center text-xs font-black text-penguin-pink-dark">{message}</p> : null}
    </div>
  );
}

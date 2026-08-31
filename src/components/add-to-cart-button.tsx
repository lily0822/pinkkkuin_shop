"use client";

import { ShoppingBasket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

function maxPurchasableQuantity(product: Product, variant: ProductVariant | null) {
  const value = variant ? variant.stockQuantity : product.stock_quantity;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { addProduct, openCart } = useCart();
  const variants = useMemo(() => (product.variants || []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [product.variants]);
  const purchasableVariants = variants.filter(isVariantAvailable);
  const hasMultipleVariants = variants.length > 1;
  const onlyVariant = variants.length === 1 ? variants[0] : null;
  const [selectedVariantId, setSelectedVariantId] = useState<string>(onlyVariant?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) || onlyVariant;
  const disabledProduct = product.status === "sold_out" || product.status === "hidden";
  const selectedUnavailable = selectedVariant ? !isVariantAvailable(selectedVariant) : false;
  const needsVariant = hasMultipleVariants && !selectedVariant;
  const price = variantDisplayPrice(product, selectedVariant || null);
  const maxQuantity = maxPurchasableQuantity(product, selectedVariant || null);
  const canIncreaseQuantity = !disabledProduct && !selectedUnavailable && !needsVariant && (maxQuantity === null || quantity < maxQuantity);
  const canDecreaseQuantity = quantity > 1;

  useEffect(() => {
    if (maxQuantity !== null && quantity > maxQuantity) {
      setQuantity(Math.max(1, maxQuantity));
    }
  }, [maxQuantity, quantity]);

  function updateQuantity(nextQuantity: number) {
    const normalized = Math.max(1, Math.floor(nextQuantity));
    setQuantity(maxQuantity === null ? normalized : Math.min(normalized, Math.max(1, maxQuantity)));
    setMessage("");
  }

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
    const added = addProduct(product, selectedVariant || null, quantity);
    setMessage(added ? "" : "已達可購買數量上限");
    if (added) openCart();
  }

  return (
    <div className="space-y-4 rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black text-penguin-pink-dark">價格</p>
          <p className="mt-1 text-3xl font-black text-penguin-pink-dark">{formatPrice(price)}</p>
        </div>
        {selectedVariant?.stockQuantity != null ? (
          <p className="rounded-full bg-penguin-cream px-3 py-1 text-xs font-black text-gray-500">
            庫存：{selectedVariant.stockQuantity}
          </p>
        ) : null}
      </div>

      {variants.length ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-black text-penguin-gray">規格</h2>
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

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-penguin-gray">數量</h2>
        </div>
        <div className="inline-flex h-11 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white shadow-sm">
          <button
            type="button"
            disabled={!canDecreaseQuantity || disabledProduct || selectedUnavailable || needsVariant}
            className="grid h-full w-11 place-items-center text-lg font-black text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:text-gray-300"
            onClick={() => updateQuantity(quantity - 1)}
            aria-label="減少數量"
          >
            -
          </button>
          <span className="min-w-12 px-3 text-center text-sm font-black text-penguin-gray">{quantity}</span>
          <button
            type="button"
            disabled={!canIncreaseQuantity}
            className="grid h-full w-11 place-items-center text-lg font-black text-penguin-pink-dark transition hover:bg-penguin-pink-light disabled:cursor-not-allowed disabled:text-gray-300"
            onClick={() => updateQuantity(quantity + 1)}
            aria-label="增加數量"
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={disabledProduct || selectedUnavailable || needsVariant || (!purchasableVariants.length && variants.length > 0)}
        onClick={handleAdd}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-penguin-pink-dark px-5 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        <ShoppingBasket size={17} />
        {disabledProduct || selectedUnavailable || (!purchasableVariants.length && variants.length > 0) ? "暫時無法購買" : needsVariant ? "請先選擇規格" : "加入購物車"}
      </button>

      {message ? <p className="text-center text-xs font-black text-penguin-pink-dark">{message}</p> : null}
    </div>
  );
}

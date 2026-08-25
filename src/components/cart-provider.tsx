"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ShoppingBasket, Trash2, X } from "lucide-react";
import { formatPrice, Product, ProductVariant, statusLabels } from "@/lib/products";

export type AddToCartVariant = ProductVariant | null;

type CartItem = {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantSpec: string | null;
  unitPrice: number;
  quantity: number;
  image?: string;
  productType: string;
  maxQuantity?: number | null;
  name?: string;
  price?: number;
  type?: string;
};

type CartContextValue = {
  count: number;
  addProduct: (product: Product, variant?: AddToCartVariant) => boolean;
  openCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const CART_STORAGE_KEY = "pinkkkuin_cart_items";

function lineItemId(productId: string, variantId?: string | null) {
  return `${productId}::${variantId || "base"}`;
}

function variantPrice(product: Product, variant?: AddToCartVariant) {
  return Number(variant?.price ?? product.price ?? 0);
}

function variantStock(product: Product, variant?: AddToCartVariant) {
  const value = variant ? variant.stockQuantity : product.stock_quantity;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function normalizeSavedItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): CartItem | null => {
      if (!item || typeof item !== "object") return null;
      const source = item as Partial<CartItem>;
      const productId = String(source.productId || source.id || "").trim();
      const productName = String(source.productName || source.name || "").trim();
      if (!productId || !productName) return null;
      const variantId = source.variantId ? String(source.variantId) : null;
      const unitPrice = Number(source.unitPrice ?? source.price ?? 0);
      const quantity = Math.max(1, Math.floor(Number(source.quantity || 1)));
      const maxQuantity = typeof source.maxQuantity === "number" && Number.isFinite(source.maxQuantity) ? source.maxQuantity : null;
      return {
        id: lineItemId(productId, variantId),
        productId,
        productName,
        variantId,
        variantSpec: source.variantSpec ? String(source.variantSpec) : null,
        unitPrice,
        quantity: maxQuantity ? Math.min(quantity, maxQuantity) : quantity,
        image: source.image,
        productType: String(source.productType || source.type || ""),
        maxQuantity,
      };
    })
    .filter((item): item is CartItem => Boolean(item));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) setItems(normalizeSavedItems(JSON.parse(saved)));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  function addProduct(product: Product, variant: AddToCartVariant = null) {
    const maxQuantity = variantStock(product, variant);
    if (maxQuantity !== null && maxQuantity <= 0) return false;
    const itemId = lineItemId(product.id, variant?.id || null);

    setItems((current) => {
      const existing = current.find((item) => item.id === itemId);
      if (existing) {
        const nextQuantity = existing.quantity + 1;
        if (existing.maxQuantity !== null && existing.maxQuantity !== undefined && nextQuantity > existing.maxQuantity) return current;
        return current.map((item) => (item.id === itemId ? { ...item, quantity: nextQuantity } : item));
      }
      return [
        ...current,
        {
          id: itemId,
          productId: product.id,
          productName: product.name_zh,
          variantId: variant?.id || null,
          variantSpec: variant?.spec || null,
          unitPrice: variantPrice(product, variant),
          productType: statusLabels[product.status],
          image: product.images[0],
          quantity: 1,
          maxQuantity,
        },
      ];
    });
    setIsOpen(true);
    return true;
  }

  function updateQuantity(id: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(id);
      return;
    }
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const nextQuantity = item.maxQuantity !== null && item.maxQuantity !== undefined ? Math.min(quantity, item.maxQuantity) : quantity;
      return { ...item, quantity: nextQuantity };
    }));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  const value = useMemo<CartContextValue>(() => ({
    count,
    addProduct,
    openCart: () => setIsOpen(true),
  }), [count]);

  return (
    <CartContext.Provider value={value}>
      {children}
      <div className={`fixed inset-0 z-50 bg-black/50 transition ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <aside className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l-4 border-penguin-pink bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
          <div className="flex items-center justify-between border-b border-penguin-pink bg-penguin-pink-light p-4">
            <h2 className="flex items-center gap-2 text-lg font-black text-penguin-pink-dark">
              <ShoppingBasket size={20} />
              購物車 ({count})
            </h2>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-penguin-gray shadow-sm hover:text-red-500"
              onClick={() => setIsOpen(false)}
              aria-label="關閉購物車"
            >
              <X size={19} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {items.length ? items.map((item) => (
              <div key={item.id} className="rounded-2xl border-2 border-penguin-peach bg-penguin-peach-light p-3">
                <div className="flex gap-3">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white text-2xl">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                    ) : "P"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-black text-penguin-gray">{item.productName}</p>
                    <p className="mt-1 text-xs font-bold text-gray-500">{item.productType}</p>
                    {item.variantSpec ? <p className="mt-1 text-xs font-black text-penguin-pink-dark">規格：{item.variantSpec}</p> : null}
                    <p className="mt-2 text-sm font-black text-penguin-pink-dark">{formatPrice(item.unitPrice)}</p>
                  </div>
                  <button
                    type="button"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-gray-400 hover:text-red-500"
                    onClick={() => removeItem(item.id)}
                    aria-label={`移除 ${item.productName}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="inline-flex items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                    <button className="px-3 py-1 font-black" onClick={() => updateQuantity(item.id, item.quantity - 1)} type="button">-</button>
                    <span className="min-w-8 text-center text-sm font-black">{item.quantity}</span>
                    <button
                      className="px-3 py-1 font-black disabled:cursor-not-allowed disabled:text-gray-300"
                      disabled={item.maxQuantity !== null && item.maxQuantity !== undefined && item.quantity >= item.maxQuantity}
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-sm font-black text-penguin-gray">{formatPrice(item.unitPrice * item.quantity)}</p>
                </div>
                {item.maxQuantity !== null && item.maxQuantity !== undefined ? (
                  <p className="mt-2 text-right text-[11px] font-bold text-gray-400">最多 {item.maxQuantity} 件</p>
                ) : null}
              </div>
            )) : (
              <div className="space-y-2 py-20 text-center text-gray-400">
                <span className="text-5xl">P</span>
                <p className="font-bold">購物車目前是空的</p>
                <p className="text-xs">先挑一個喜歡的商品放進來吧。</p>
              </div>
            )}
          </div>

          <div className="border-t bg-white p-4">
            <div className="mb-3 flex items-center justify-between text-sm font-black">
              <span>小計</span>
              <span className="text-lg text-penguin-pink-dark">{formatPrice(total)}</span>
            </div>
            <a
              href="https://line.me/R/ti/p/@pinkkkuin"
              className="block rounded-2xl bg-penguin-pink-dark py-3 text-center text-sm font-black text-white shadow-md hover:bg-penguin-pink"
            >
              帶著購物車私訊小企鵝
            </a>
          </div>
        </aside>
      </div>
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider.");
  return context;
}

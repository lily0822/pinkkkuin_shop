"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ShoppingBasket, Trash2, X } from "lucide-react";
import { formatPrice, Product, ProductVariant, statusLabels } from "@/lib/products";

export type AddToCartVariant = ProductVariant | null;
export type CartProductTypeKey = "stock" | "preorder" | "unknown";

export type CartItem = {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantSpec: string | null;
  unitPrice: number;
  quantity: number;
  image?: string;
  productType: string;
  productTypeKey: CartProductTypeKey;
  selected: boolean;
  maxQuantity?: number | null;
  name?: string;
  price?: number;
  type?: string;
};

type CartContextValue = {
  count: number;
  items: CartItem[];
  total: number;
  selectedItems: CartItem[];
  selectedLineCount: number;
  selectedQuantity: number;
  selectedTotal: number;
  addProduct: (product: Product, variant?: AddToCartVariant, quantity?: number) => boolean;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  toggleItemSelected: (id: string, selected?: boolean) => void;
  setAllItemsSelected: (selected: boolean) => void;
  setItemsSelectedByType: (type: CartProductTypeKey, selected: boolean) => void;
  openCart: () => void;
  closeCart: () => void;
  clearCart: () => void;
  clearSelectedItems: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const CART_STORAGE_KEY = "pinkkkuin_cart_items";

function lineItemId(productId: string, variantId?: string | null) {
  return `${productId}::${variantId || "base"}`;
}

function variantPrice(product: Product, variant?: AddToCartVariant) {
  return Number(variant?.price ?? product.price ?? 0);
}

export function variantStock(product: Product, variant?: AddToCartVariant) {
  const value = variant ? variant.stockQuantity : product.stock_quantity;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function productTypeKeyFromProduct(product: Product): CartProductTypeKey {
  return product.status === "preorder" ? "preorder" : "stock";
}

function normalizeProductTypeKey(value: unknown, label?: unknown): CartProductTypeKey {
  const normalized = String(value || label || "").trim().toLowerCase();
  if (normalized === "preorder" || normalized === "預購") return "preorder";
  if (normalized === "stock" || normalized === "in_stock" || normalized === "現貨") return "stock";
  return "unknown";
}

function productTypeLabel(type: CartProductTypeKey, fallback: string) {
  if (type === "stock") return "現貨";
  if (type === "preorder") return "預購";
  return fallback || "商品";
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
      const productTypeKey = normalizeProductTypeKey(source.productTypeKey, source.productType || source.type);
      return {
        id: lineItemId(productId, variantId),
        productId,
        productName,
        variantId,
        variantSpec: source.variantSpec ? String(source.variantSpec) : null,
        unitPrice,
        quantity: maxQuantity ? Math.min(quantity, maxQuantity) : quantity,
        image: source.image,
        productType: productTypeLabel(productTypeKey, String(source.productType || source.type || "")),
        productTypeKey,
        selected: source.selected !== false,
        maxQuantity,
      };
    })
    .filter((item): item is CartItem => Boolean(item));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [limitNoticeId, setLimitNoticeId] = useState<string | null>(null);
  const limitNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => () => {
    if (limitNoticeTimeoutRef.current) clearTimeout(limitNoticeTimeoutRef.current);
  }, []);

  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const selectedItems = items.filter((item) => item.selected !== false);
  const selectedLineCount = selectedItems.length;
  const selectedQuantity = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const selectedTotal = selectedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  function addProduct(product: Product, variant: AddToCartVariant = null, quantity = 1) {
    const maxQuantity = variantStock(product, variant);
    if (maxQuantity !== null && maxQuantity <= 0) return false;
    const itemId = lineItemId(product.id, variant?.id || null);
    const addQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    const existing = items.find((item) => item.id === itemId);

    if (existing && existing.maxQuantity !== null && existing.maxQuantity !== undefined && existing.quantity + addQuantity > existing.maxQuantity) {
      return false;
    }

    if (!existing && maxQuantity !== null && addQuantity > maxQuantity) {
      return false;
    }

    setItems((current) => {
      const currentExisting = current.find((item) => item.id === itemId);
      if (currentExisting) {
        const nextQuantity = currentExisting.quantity + addQuantity;
        if (currentExisting.maxQuantity !== null && currentExisting.maxQuantity !== undefined && nextQuantity > currentExisting.maxQuantity) return current;
        return current.map((item) => (item.id === itemId ? { ...item, quantity: nextQuantity, selected: true } : item));
      }
      const productTypeKey = productTypeKeyFromProduct(product);
      return [
        ...current,
        {
          id: itemId,
          productId: product.id,
          productName: product.name_zh,
          variantId: variant?.id || null,
          variantSpec: variant?.spec || null,
          unitPrice: variantPrice(product, variant),
          productType: productTypeLabel(productTypeKey, statusLabels[product.status]),
          productTypeKey,
          selected: true,
          image: product.images[0],
          quantity: addQuantity,
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

  function increaseDrawerQuantity(item: CartItem) {
    if (item.maxQuantity !== null && item.maxQuantity !== undefined && item.quantity >= item.maxQuantity) {
      setLimitNoticeId(item.id);
      if (limitNoticeTimeoutRef.current) clearTimeout(limitNoticeTimeoutRef.current);
      limitNoticeTimeoutRef.current = setTimeout(() => setLimitNoticeId(null), 2200);
      return;
    }
    setLimitNoticeId(null);
    updateQuantity(item.id, item.quantity + 1);
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function clearCart() {
    setItems([]);
    setIsOpen(false);
  }

  function clearSelectedItems() {
    setItems((current) => current.filter((item) => item.selected === false));
    setIsOpen(false);
  }

  function toggleItemSelected(id: string, selected?: boolean) {
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, selected: selected ?? item.selected === false } : item
    )));
  }

  function setAllItemsSelected(selected: boolean) {
    setItems((current) => current.map((item) => ({ ...item, selected })));
  }

  function setItemsSelectedByType(type: CartProductTypeKey, selected: boolean) {
    setItems((current) => current.map((item) => (
      item.productTypeKey === type ? { ...item, selected } : item
    )));
  }

  const value = useMemo<CartContextValue>(() => ({
    count,
    items,
    total,
    selectedItems,
    selectedLineCount,
    selectedQuantity,
    selectedTotal,
    addProduct,
    updateQuantity,
    removeItem,
    toggleItemSelected,
    setAllItemsSelected,
    setItemsSelectedByType,
    openCart: () => setIsOpen(true),
    closeCart: () => setIsOpen(false),
    clearCart,
    clearSelectedItems,
  }), [count, items, selectedItems, selectedLineCount, selectedQuantity, selectedTotal, total]);

  return (
    <CartContext.Provider value={value}>
      {children}
      <div
        className={`fixed inset-0 z-50 bg-penguin-gray/25 transition-opacity ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      >
        <aside
          className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l-4 border-penguin-pink bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
          onClick={(event) => event.stopPropagation()}
        >
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
              <div key={item.id} className="rounded-2xl border-2 border-penguin-peach bg-penguin-peach-light p-3 transition">
                <div className="flex gap-3">
                  <div className="grid h-[92px] w-[92px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-2xl" style={{ width: 92, height: 92 }}>
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                    ) : "P"}
                  </div>
                  <div className="flex h-[92px] min-w-0 flex-1 flex-col" style={{ height: 92 }}>
                    <div className="flex min-h-0 items-start justify-between gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-sm font-black leading-4 text-penguin-gray">
                        <span className={`mr-1.5 inline-flex shrink-0 whitespace-nowrap align-middle rounded-full px-2 py-0.5 text-sm font-black leading-4 text-penguin-gray ${
                          item.productTypeKey === "stock"
                            ? "bg-emerald-100"
                            : "bg-penguin-pink"
                        }`}>
                          {item.productType}
                        </span>
                        {item.productName}
                      </p>
                      <button
                        type="button"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-gray-400 hover:text-red-500"
                        onClick={() => removeItem(item.id)}
                        aria-label={`移除 ${item.productName}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-auto">
                      <div className="flex h-4 min-w-0 shrink-0 items-center justify-between gap-1 text-xs font-black leading-4 text-penguin-gray">
                        {item.variantSpec ? <p className="min-w-0 truncate">規格：{item.variantSpec}</p> : <span aria-hidden="true">&nbsp;</span>}
                        {limitNoticeId === item.id ? <p className="shrink-0 text-[10px] text-penguin-pink-dark" role="status">已達可購買數量上限</p> : null}
                      </div>
                      <div className="flex h-7 shrink-0 items-center justify-between gap-2">
                        <p className="min-w-0 text-xs font-black leading-5 text-penguin-gray">小計：{formatPrice(item.unitPrice * item.quantity)}</p>
                        <div className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                          <button className="grid h-full w-8 place-items-center font-black disabled:cursor-not-allowed disabled:text-gray-300" disabled={item.quantity <= 1} onClick={() => updateQuantity(item.id, item.quantity - 1)} type="button">-</button>
                          <span className="min-w-7 text-center text-sm font-black">{item.quantity}</span>
                          <button
                            className="grid h-full w-8 place-items-center font-black"
                            onClick={() => increaseDrawerQuantity(item)}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
              <span>本次小計</span>
              <span className="text-lg text-penguin-pink-dark">{formatPrice(selectedTotal)}</span>
            </div>
            <div className="mb-3 text-xs font-bold text-gray-500">
              已選 {selectedQuantity} 件商品
              {!selectedLineCount ? <span className="ml-2 text-red-500">請至少選擇一件要結帳的商品</span> : null}
            </div>
            <div className="grid gap-2">
              <Link
                href="/cart"
                onClick={() => setIsOpen(false)}
                className={`block rounded-2xl py-3 text-center text-sm font-black shadow-md transition ${
                  selectedLineCount
                    ? "bg-penguin-pink-dark text-white hover:bg-penguin-pink"
                    : "pointer-events-none bg-gray-200 text-gray-400"
                }`}
              >
                確認購物車
              </Link>
              <a
                href="https://line.me/R/ti/p/@pinkkkuin"
                className="block rounded-2xl border-2 border-[#06C755] bg-white py-3 text-center text-sm font-black text-[#06A948] shadow-sm hover:bg-emerald-50"
              >
                帶著購物車私訊小企鵝
              </a>
            </div>
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

"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ShoppingBasket, Trash2, X } from "lucide-react";
import { formatPrice, Product, statusLabels } from "@/lib/products";

type CartItem = {
  id: string;
  name: string;
  price: number;
  type: string;
  image?: string;
  quantity: number;
};

type CartContextValue = {
  count: number;
  addProduct: (product: Product) => void;
  openCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const CART_STORAGE_KEY = "pinkkkuin_cart_items";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
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
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  function addProduct(product: Product) {
    setItems((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [
        ...current,
        {
          id: product.id,
          name: product.name_zh,
          price: product.price,
          type: statusLabels[product.status],
          image: product.images[0],
          quantity: 1,
        },
      ];
    });
    setIsOpen(true);
  }

  function updateQuantity(id: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(id);
      return;
    }
    setItems((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)));
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
              我的企鵝選物箱 ({count})
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
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    ) : "🐧"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-black text-penguin-gray">{item.name}</p>
                    <p className="mt-1 text-xs font-bold text-gray-500">{item.type}</p>
                    <p className="mt-2 text-sm font-black text-penguin-pink-dark">{formatPrice(item.price)}</p>
                  </div>
                  <button
                    type="button"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-gray-400 hover:text-red-500"
                    onClick={() => removeItem(item.id)}
                    aria-label={`移除 ${item.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="inline-flex items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                    <button className="px-3 py-1 font-black" onClick={() => updateQuantity(item.id, item.quantity - 1)} type="button">-</button>
                    <span className="min-w-8 text-center text-sm font-black">{item.quantity}</span>
                    <button className="px-3 py-1 font-black" onClick={() => updateQuantity(item.id, item.quantity + 1)} type="button">+</button>
                  </div>
                  <p className="text-sm font-black text-penguin-gray">{formatPrice(item.price * item.quantity)}</p>
                </div>
              </div>
            )) : (
              <div className="space-y-2 py-20 text-center text-gray-400">
                <span className="text-5xl">🛒</span>
                <p className="font-bold">您的購物車是空的喔！</p>
                <p className="text-xs">看到喜歡的日本選物，就先加入選物箱吧。</p>
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
              傳給小企鵝確認訂單
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

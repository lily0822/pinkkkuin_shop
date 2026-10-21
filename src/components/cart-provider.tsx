"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ClipboardList, ShoppingBasket, Trash2, X } from "lucide-react";
import { formatPrice, Product, ProductVariant, statusLabels } from "@/lib/products";
import { usePreorderList } from "@/components/preorder-list-provider";

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
  openPreorderList: () => void;
  toggleCart: () => void;
  togglePreorderList: () => void;
  closeCart: () => void;
  clearCart: () => void;
  clearSelectedItems: () => void;
};

type DrawerTab = "cart" | "preorder";

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
  return product.productType;
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

// 回傳同時帶著「有沒有濾掉舊的預購項目」，讓呼叫端（mount 時的載入
// effect）決定要不要顯示一次性的搬移提示——購物車本來就可能存著改版前
// 加進去的預購項目，正規化階段直接濾掉，不要讓它們留在購物車裡。
function normalizeSavedItems(value: unknown): { items: CartItem[]; hadPreorder: boolean } {
  if (!Array.isArray(value)) return { items: [], hadPreorder: false };
  let hadPreorder = false;
  const items = value
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
      if (productTypeKey === "preorder") {
        hadPreorder = true;
        return null;
      }
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
  return { items, hadPreorder };
}

const PREORDER_MIGRATION_NOTICE_KEY = "pinkkkuin_cart_preorder_migration_notice_shown";
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("cart");
  const [limitNoticeId, setLimitNoticeId] = useState<string | null>(null);
  const limitNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preorderMigrationNotice, setPreorderMigrationNotice] = useState(false);
  const preorderList = usePreorderList();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (!saved) return;
      const { items: loadedItems, hadPreorder } = normalizeSavedItems(JSON.parse(saved));
      // 從 localStorage 讀回的購物車內容本來就要在掛載時同步進 React
      // state（跟既有 product-gallery.tsx 的 set-state-in-effect 理由一樣：
      // 外部系統狀態同步，不是能在 render 階段算出來的值），不是能改寫成
      // render-time 計算的情況。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(loadedItems);
      if (hadPreorder) {
        let alreadyShown = false;
        try {
          alreadyShown = window.localStorage.getItem(PREORDER_MIGRATION_NOTICE_KEY) === "1";
        } catch {}
        if (!alreadyShown) {
          setPreorderMigrationNotice(true);
          try {
            window.localStorage.setItem(PREORDER_MIGRATION_NOTICE_KEY, "1");
          } catch {}
        }
      }
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (!preorderMigrationNotice) return;
    const timeout = setTimeout(() => setPreorderMigrationNotice(false), 4000);
    return () => clearTimeout(timeout);
  }, [preorderMigrationNotice]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    // 電腦版面板是浮在頁面上面的懸浮面板，不蓋住、不鎖住背景捲動；只有
    // 手機版的滿版抽屜才需要鎖住背景捲動。用 matchMedia 動態反應寬度
    // 變化（例如視窗從手機寬度被拉寬到電腦寬度時要立刻解除鎖定），不是
    // 只看掛載當下量到的寬度。
    function syncBodyScrollLock() {
      document.body.style.overflow = mediaQuery.matches ? previousOverflow : "hidden";
    }

    syncBodyScrollLock();
    mediaQuery.addEventListener("change", syncBodyScrollLock);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      mediaQuery.removeEventListener("change", syncBodyScrollLock);
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
    // 保險：預購商品一律不該進購物車（這輪改版把所有「加入」入口都改走
    // 預購清單），這裡擋一次是防呆，避免之後又有入口漏改而漏判。
    if (product.productType === "preorder") return false;
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
          // 這個規格有自己的專屬圖片就用那張，沒有才退回商品主圖——不管
          // 選的是哪個規格，購物車項目的縮圖都要跟著變，不是固定第一張。
          image: variant?.imageUrl || product.images[0],
          quantity: addQuantity,
          maxQuantity,
        },
      ];
    });
    setActiveTab("cart");
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

  // 電腦版資料夾標籤／標頭按鈕共用的「切換」語意：收合時展開並切到該
  // 分頁；已經展開且就停在這個分頁時收合；展開但停在另一個分頁時單純
  // 切換過去（不收合）。手機版的橫向分頁列跟標頭按鈕刻意不走這支函式
  // ——手機版維持原本「只會展開、不會因為點同一個分頁而收合」的行為。
  function toggleTab(tab: DrawerTab) {
    if (isOpen && activeTab === tab) {
      setIsOpen(false);
      return;
    }
    setActiveTab(tab);
    setIsOpen(true);
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
    openCart: () => {
      setActiveTab("cart");
      setIsOpen(true);
    },
    openPreorderList: () => {
      setActiveTab("preorder");
      setIsOpen(true);
    },
    toggleCart: () => toggleTab("cart"),
    togglePreorderList: () => toggleTab("preorder"),
    closeCart: () => setIsOpen(false),
    clearCart,
    clearSelectedItems,
  }), [count, items, selectedItems, selectedLineCount, selectedQuantity, selectedTotal, total, isOpen, activeTab]);

  // 分頁切換會跟著換抽屜邊框/標題列底色/主要按鈕顏色（資料夾標籤版
  // 設計，定案用配色B：柔和淡黃）——購物車沿用既有 penguin-pink-dark/
  // penguin-pink-light 這組既有 token；預購清單是這組設計稿專用的柔和
  // 淡黃色，不在既有 design token 裡（#fff9df/#f0dc8f/#e8cc5c 這三個
  // 色碼只在這個抽屜用，不是重用 penguin-yellow），所以用 Tailwind
  // 任意值寫死。ctaBorder 跟 border/tabActiveBorder 的色碼刻意不同
  // （按鈕邊框用對比度更高的 #e8cc5c，標籤/抽屜外框用較淺的 #f0dc8f）——
  // 這是設計稿裡的既定差異，不是疏漏。
  const drawerTheme = activeTab === "cart"
    ? {
        border: "border-penguin-pink-dark",
        headerBg: "bg-penguin-pink-light",
        ctaBg: "bg-penguin-pink-light",
        ctaBorder: "border-penguin-pink-dark",
        tabActiveBg: "bg-[#fff8fb]",
        tabActiveBorder: "border-penguin-pink-dark",
      }
    : {
        border: "border-[#f0dc8f]",
        headerBg: "bg-[#fff9df]",
        ctaBg: "bg-[#fff9df]",
        ctaBorder: "border-[#e8cc5c]",
        tabActiveBg: "bg-[#fffdf4]",
        tabActiveBorder: "border-[#f0dc8f]",
      };

  const preorderTotal = preorderList.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return (
    <CartContext.Provider value={value}>
      {children}
      {preorderMigrationNotice ? (
        <div
          role="status"
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-[#e8cc5c] bg-[#fff9df] px-4 py-2 text-sm font-black text-penguin-gray shadow-lg"
        >
          預購商品已移到預購清單，請重新加入
        </div>
      ) : null}
      {/* 電腦版（md 以上）這層外框不再畫暗色遮罩、也不攔截點擊
          （md:pointer-events-none），後面的頁面照常可以點擊/捲動——面板
          本身改成浮在頁面上面的懸浮面板，不是會擋住整個畫面的抽屜。
          手機版（md 以下）維持原本的暗色遮罩＋點外面關閉。這層本身不能
          再用 opacity 控制顯示/隱藏（opacity 會連帶讓子元素的資料夾
          標籤在收合時也完全隱藏，跟「電腦版收合時標籤仍固定顯示在畫面
          右緣」的需求衝突），改成只用 bg-transparent 切換要不要畫暗色
          底色，aside 自己的 translate-x 才是真正控制面板本身顯示/隱藏
          的機制。 */}
      <div
        className={`fixed inset-0 z-50 transition-colors md:pointer-events-none md:bg-transparent ${
          isOpen ? "bg-penguin-gray/25 pointer-events-auto" : "pointer-events-none bg-transparent"
        }`}
        onClick={() => setIsOpen(false)}
      >
        {/* 電腦版多了 md:top-24/md:bottom-4/md:h-auto 幾個 class 讓面板
            往下讓出標頭（sticky header，約 80px 高）的空間、底部留一點
            呼吸空間，不會蓋住標頭或超出畫面底部；手機版的 top-0/h-full
            完全不變，一樣是滿版抽屜。pointer-events-auto 是因為上面這層
            外框在電腦版永遠是 pointer-events-none，面板自己要明確加回來
            才能繼續被點擊（手機版外框本來就會視 isOpen 給 auto，這裡重複
            加一次是無害的）。

            電腦版才加 md:border-t-4/md:border-b-4（跟既有的 border-l-4
            同樣粗、同一個 drawerTheme.border 色碼，三邊一起包起來）＋
            md:rounded-l-[14px]（跟桌機資料夾標籤的 rounded-l-[14px] 用
            一樣的角度，視覺上是同一組圓角語彙）；右邊貼著螢幕邊緣，刻意
            不加邊框/圓角。選中的資料夾標籤固定從 top-3.5（14px）開始、
            右邊無邊框直接貼上面板左緣——這個銜接點本來就落在面板左邊框
            「還是直線」的那一段（圓角只發生在最頂跟最底各 14px 的範圍，
            剛好跟 top-3.5 的位置對齊，不會咬到標籤的高度範圍），所以加了
            上下邊框跟圓角之後，標籤蓋住面板左邊框、線條連續的視覺效果
            不受影響；手機版沒有這些 md: class，維持原本只有左邊框、沒有
            圓角的滿版抽屜。陰影（shadow-2xl）是瀏覽器原生跟著
            border-radius 走的，不用額外加 class 處理圓角陰影。 */}
        <aside
          className={`pointer-events-auto absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l-4 md:top-24 md:bottom-4 md:h-auto md:border-t-4 md:border-b-4 md:rounded-l-[14px] ${drawerTheme.border} bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
          onClick={(event) => event.stopPropagation()}
        >
          {/* 桌機：資料夾標籤從抽屜左緣長出來，取代上面那條手機版的
              橫向分頁列；選中的標籤填色跟抽屜內容區同色、邊框色跟抽屜
              外框一致，造成線條直接接上去、沒有凸起接縫的視覺效果。 */}
          <div className="absolute right-full top-3.5 z-10 hidden flex-col gap-2 md:flex">
            <button
              type="button"
              onClick={() => toggleTab("cart")}
              style={{ writingMode: "vertical-rl", textOrientation: "upright", letterSpacing: "0.12em" }}
              className={`relative flex h-[150px] items-center justify-center rounded-l-[14px] border-4 border-r-0 text-sm font-black text-[#3a4150] ${
                activeTab === "cart"
                  ? `w-[46px] ${drawerTheme.tabActiveBg} ${drawerTheme.tabActiveBorder}`
                  : `w-[42px] mr-1 opacity-90 bg-penguin-pink-light border-[#fbcfe0]`
              }`}
            >
              購物車
              {count > 0 ? (
                <span className="absolute -left-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] text-white" style={{ writingMode: "horizontal-tb" }}>
                  {count}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => toggleTab("preorder")}
              style={{ writingMode: "vertical-rl", textOrientation: "upright", letterSpacing: "0.12em" }}
              className={`relative flex h-[150px] items-center justify-center rounded-l-[14px] border-4 border-r-0 text-sm font-black text-[#3a4150] ${
                activeTab === "preorder"
                  ? `w-[46px] ${drawerTheme.tabActiveBg} ${drawerTheme.tabActiveBorder}`
                  : `w-[42px] mr-1 opacity-90 bg-[#fff9df] border-[#f6e9ab]`
              }`}
            >
              預購清單
              {preorderList.count > 0 ? (
                <span className="absolute -left-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] text-white" style={{ writingMode: "horizontal-tb" }}>
                  {preorderList.count}
                </span>
              ) : null}
            </button>
          </div>

          {/* 手機：維持原本橫向切換分頁（上方整排兩顆），桌機改用左側
              資料夾標籤，這排在桌機隱藏。 */}
          <div className="flex border-b border-gray-200 md:hidden">
            <button
              type="button"
              onClick={() => setActiveTab("cart")}
              className={`flex-1 py-3 text-center text-sm font-black text-[#111] transition ${
                activeTab === "cart" ? "border-b-[3px] border-penguin-pink-dark bg-penguin-pink-light" : "bg-white"
              }`}
            >
              購物車 ({count})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preorder")}
              className={`flex-1 py-3 text-center text-sm font-black text-[#111] transition ${
                activeTab === "preorder" ? `border-b-[3px] ${drawerTheme.border} ${drawerTheme.headerBg}` : "bg-white"
              }`}
            >
              預購清單 ({preorderList.count})
            </button>
          </div>

          <div className={`flex items-center justify-between border-b p-4 ${drawerTheme.border} ${drawerTheme.headerBg}`}>
            <h2 className="flex items-center gap-2 text-lg font-black text-[#111]">
              {activeTab === "cart" ? <ShoppingBasket size={20} /> : <ClipboardList size={20} />}
              {activeTab === "cart" ? "購物車" : "預購清單"}
            </h2>
            {/* 電腦版才顯示的收合按鈕（不是關閉，面板本身一直存在、只是
                收合成右側標籤）；手機版沿用下面那顆 X 關閉按鈕。 */}
            <button
              type="button"
              className="hidden h-8 w-8 items-center justify-center rounded-full bg-white text-penguin-gray shadow-sm hover:text-penguin-pink-dark md:grid"
              onClick={() => setIsOpen(false)}
              aria-label={activeTab === "cart" ? "收合購物車" : "收合預購清單"}
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-penguin-gray shadow-sm hover:text-red-500 md:hidden"
              onClick={() => setIsOpen(false)}
              aria-label={activeTab === "cart" ? "關閉購物車" : "關閉預購清單"}
            >
              <X size={19} />
            </button>
          </div>

          {activeTab === "preorder" ? (
            <>
              <div className="flex-1 overflow-y-auto p-4">
                {preorderList.accessState === "loading" ? (
                  <p className="py-20 text-center text-sm font-bold text-gray-400">載入中...</p>
                ) : preorderList.accessState === "unauthenticated" ? (
                  <div className="space-y-3 py-16 text-center text-gray-500">
                    <p className="text-sm font-bold">請先登入會員才能使用預購清單。</p>
                    <Link href="/login" onClick={() => setIsOpen(false)} className={`inline-flex rounded-full border-2 px-5 py-2 text-sm font-black text-[#111] transition ${drawerTheme.ctaBg} ${drawerTheme.ctaBorder}`}>
                      前往登入
                    </Link>
                  </div>
                ) : preorderList.accessState === "not_linked" ? (
                  <div className="space-y-3 py-16 text-center text-gray-500">
                    <p className="text-sm font-bold">請先完成 LINE 綁定才能使用預購清單。</p>
                    <Link href="/member/account" onClick={() => setIsOpen(false)} className={`inline-flex rounded-full border-2 px-5 py-2 text-sm font-black text-[#111] transition ${drawerTheme.ctaBg} ${drawerTheme.ctaBorder}`}>
                      前往綁定
                    </Link>
                  </div>
                ) : preorderList.accessState === "error" ? (
                  <div className="space-y-3 py-16 text-center text-gray-500">
                    <p className="text-sm font-bold">預購清單讀取失敗，請稍後再試。</p>
                    <button type="button" onClick={preorderList.refresh} className="rounded-full border-2 border-gray-300 px-5 py-2 text-sm font-black text-gray-600">
                      重新讀取
                    </button>
                  </div>
                ) : preorderList.items.length ? (
                  preorderList.items.map((item, index) => (
                    <div key={item.id} className={`flex gap-3 py-3 ${index < preorderList.items.length - 1 ? "border-b border-[#f6e9ab]" : ""}`}>
                        <div className="grid h-[92px] w-[92px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-2xl" style={{ width: 92, height: 92 }}>
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                          ) : "P"}
                        </div>
                        <div className="flex h-[92px] min-w-0 flex-1 flex-col" style={{ height: 92 }}>
                          <div className="flex min-h-0 items-start justify-between gap-2">
                            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-black leading-4 text-[#3a4150]">{item.productName}</p>
                            <button
                              type="button"
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-gray-400 hover:text-red-500"
                              onClick={() => preorderList.removeItem(item.id)}
                              aria-label={`移除 ${item.productName}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="mt-auto">
                            <div className="flex h-4 min-w-0 shrink-0 items-center justify-between gap-1 text-xs font-black leading-4 text-[#565e6d]">
                              <p className="min-w-0 truncate">
                                {[item.seriesName ? `系列：${item.seriesName}` : null, item.variantSpec ? `規格：${item.variantSpec}` : null]
                                  .filter(Boolean)
                                  .join(" ・ ") || " "}
                              </p>
                            </div>
                            <div className="flex h-7 shrink-0 items-center justify-between gap-2">
                              <p className="min-w-0 text-xs font-black leading-5 text-[#3a4150]">小計：{formatPrice(item.unitPrice * item.quantity)}</p>
                              <div className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                                <button
                                  className="grid h-full w-8 place-items-center font-black text-[#3a4150] disabled:cursor-not-allowed disabled:text-gray-300"
                                  disabled={item.quantity <= 1}
                                  onClick={() => preorderList.updateQuantity(item.id, item.quantity - 1)}
                                  type="button"
                                >
                                  -
                                </button>
                                <span className="min-w-7 text-center text-sm font-black text-[#3a4150]">{item.quantity}</span>
                                <button
                                  className="grid h-full w-8 place-items-center font-black text-[#3a4150]"
                                  onClick={() => preorderList.updateQuantity(item.id, item.quantity + 1)}
                                  type="button"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                    </div>
                  ))
                ) : (
                  <div className="space-y-2 py-20 text-center text-gray-400">
                    <span className="text-5xl">P</span>
                    <p className="font-bold">預購清單目前是空的</p>
                    <p className="text-xs">先去挑選想預購的商品吧。</p>
                  </div>
                )}
              </div>

              {preorderList.accessState === "ok" ? (
                <div className="border-t bg-white p-4">
                  {preorderList.submitResult ? (
                    <div className="space-y-3 text-center">
                      <p className="text-sm font-black text-[#111]">
                        預購登記成功！訂單編號 {preorderList.submitResult.orderNo}，總金額 {formatPrice(preorderList.submitResult.total)}
                      </p>
                      <Link
                        href="/member/orders"
                        onClick={() => setIsOpen(false)}
                        className={`block rounded-2xl border-2 py-3 text-center text-sm font-black text-[#111] shadow-md transition ${drawerTheme.ctaBg} ${drawerTheme.ctaBorder}`}
                      >
                        查看我的預購
                      </Link>
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between text-sm font-black text-[#111]">
                        <span>預購總額</span>
                        <span className="text-lg text-[#111]">{formatPrice(preorderTotal)}</span>
                      </div>
                      <div className="mb-3 text-xs font-bold text-gray-500">
                        總共 {preorderList.count} 件商品
                      </div>
                      {preorderList.submitError ? <p className="mb-3 text-xs font-bold text-red-500">{preorderList.submitError}</p> : null}
                      <button
                        type="button"
                        onClick={preorderList.submit}
                        disabled={preorderList.submitting || !preorderList.items.length}
                        className={`block w-full rounded-2xl border-2 py-3 text-center text-sm font-black text-[#111] shadow-md transition ${drawerTheme.ctaBg} ${drawerTheme.ctaBorder} disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-400`}
                      >
                        {preorderList.submitting ? "送出中..." : "送出預購清單"}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : (
          <>
          <div className="flex-1 overflow-y-auto p-4">
            {items.length ? items.map((item, index) => (
              <div key={item.id} className={`flex gap-3 py-3 ${index < items.length - 1 ? "border-b border-[#fbcfe0]" : ""}`}>
                  <div className="grid h-[92px] w-[92px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-2xl" style={{ width: 92, height: 92 }}>
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                    ) : "P"}
                  </div>
                  <div className="flex h-[92px] min-w-0 flex-1 flex-col" style={{ height: 92 }}>
                    <div className="flex min-h-0 items-start justify-between gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-sm font-black leading-4 text-[#3a4150]">
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
                      <div className="flex h-4 min-w-0 shrink-0 items-center justify-between gap-1 text-xs font-black leading-4 text-[#565e6d]">
                        {item.variantSpec ? <p className="min-w-0 truncate">規格：{item.variantSpec}</p> : <span aria-hidden="true">&nbsp;</span>}
                        {limitNoticeId === item.id ? <p className="shrink-0 text-[10px] text-penguin-pink-dark" role="status">已達可購買數量上限</p> : null}
                      </div>
                      <div className="flex h-7 shrink-0 items-center justify-between gap-2">
                        <p className="min-w-0 text-xs font-black leading-5 text-[#3a4150]">小計：{formatPrice(item.unitPrice * item.quantity)}</p>
                        <div className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                          <button className="grid h-full w-8 place-items-center font-black text-[#3a4150] disabled:cursor-not-allowed disabled:text-gray-300" disabled={item.quantity <= 1} onClick={() => updateQuantity(item.id, item.quantity - 1)} type="button">-</button>
                          <span className="min-w-7 text-center text-sm font-black text-[#3a4150]">{item.quantity}</span>
                          <button
                            className="grid h-full w-8 place-items-center font-black text-[#3a4150]"
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
            )) : (
              <div className="space-y-2 py-20 text-center text-gray-400">
                <span className="text-5xl">P</span>
                <p className="font-bold">購物車目前是空的</p>
                <p className="text-xs">先挑一個喜歡的商品放進來吧。</p>
              </div>
            )}
          </div>

          <div className="border-t bg-white p-4">
            <div className="mb-3 flex items-center justify-between text-sm font-black text-[#111]">
              <span>本次小計</span>
              <span className="text-lg text-[#111]">{formatPrice(total)}</span>
            </div>
            <div className="mb-3 text-xs font-bold text-gray-500">
              總共 {count} 件商品
            </div>
            <div className="grid gap-2">
              <Link
                href="/cart"
                onClick={() => setIsOpen(false)}
                className={`block rounded-2xl border-2 py-3 text-center text-sm font-black text-[#111] shadow-md transition ${
                  items.length
                    ? `${drawerTheme.ctaBg} ${drawerTheme.ctaBorder} hover:bg-penguin-pink`
                    : "pointer-events-none border-gray-200 bg-gray-200 text-gray-400"
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
          </>
          )}
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

"use client";

import { useMemo, useState } from "react";
import { MemberLivestreamOrders } from "@/components/member-livestream-orders";
import { MemberOrderList, type MemberOrder } from "@/components/member-order-list";

type OrderTab = "stock" | "preorder" | "live";

// 三個分頁各自的配色——現貨沿用既有 penguin-pink 那套；預購跟連線下單
// 比照抽屜分頁改版時定案/探索過的柔和色（預購＝柔和淡黃，跟抽屜「預購
// 清單」分頁同一組色碼；連線下單＝柔和綠，沿用設計稿裡「配色C：綠」
// 那組色碼，這次拿來用在這裡）。
const tabThemes: Record<OrderTab, { label: string; activeBorder: string; activeBg: string; badgeBg: string }> = {
  stock: { label: "現貨", activeBorder: "border-penguin-pink-dark", activeBg: "bg-penguin-pink-light", badgeBg: "bg-penguin-pink-light" },
  preorder: { label: "預購", activeBorder: "border-[#f0dc8f]", activeBg: "bg-[#fff9df]", badgeBg: "bg-[#fff9df]" },
  live: { label: "連線下單", activeBorder: "border-[#8fd3ae]", activeBg: "bg-[#e9f8ef]", badgeBg: "bg-[#e9f8ef]" },
};

const tabOrder: OrderTab[] = ["stock", "preorder", "live"];

export function MemberOrdersTabs({ initialOrders }: { initialOrders: MemberOrder[] }) {
  const [tab, setTab] = useState<OrderTab>("stock");

  const stockOrders = useMemo(() => initialOrders.filter((order) => order.productType === "stock"), [initialOrders]);
  const preorderOrders = useMemo(() => initialOrders.filter((order) => order.productType === "preorder"), [initialOrders]);

  return (
    <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-black text-penguin-gray">我的訂單</h2>
        <p className="text-sm font-bold text-gray-500">現貨、預購、連線下單分開顯示。</p>
      </div>

      <div className="mt-5 flex gap-2 border-b-2 border-penguin-peach">
        {tabOrder.map((value) => {
          const theme = tabThemes[value];
          const isActive = tab === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`-mb-0.5 border-b-[3px] px-3 py-2.5 text-sm font-black transition ${
                isActive ? `${theme.activeBorder} ${theme.activeBg} text-[#111]` : "border-transparent text-gray-400"
              }`}
            >
              {theme.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {tab === "stock" ? (
          // key 是關鍵：兩個分頁在這個三元運算式裡渲染的是同一個元件
          // （MemberOrderList），位置也相同，沒有 key 的話 React 會直接
          // 重用上一個分頁的實例，該元件內部 useState(initialOrders) 只
          // 在第一次掛載時複製一次 orders，之後切分頁只是換 props、不會
          // 觸發重新初始化，畫面就會卡在舊分頁的訂單。給不同的 key 強制
          // React 在切分頁時整個卸載舊實例、重新掛載新實例，orders/
          // openIds/loadingId/error 這些內部 state 全部跟著重置，不會
          // 殘留到另一個分頁。
          <MemberOrderList key="stock" orders={stockOrders} theme={{ badgeBg: tabThemes.stock.badgeBg }} emptyText="目前還沒有現貨訂單。" />
        ) : tab === "preorder" ? (
          <MemberOrderList key="preorder" orders={preorderOrders} theme={{ badgeBg: tabThemes.preorder.badgeBg }} emptyText="目前還沒有預購訂單。" />
        ) : (
          // 連線下單用的是完全不同的元件類型（不是 MemberOrderList），
          // 跟現貨/預購分頁切換時本來就會因為元件類型不同被 React 整個
          // 卸載重新掛載，不會有上面那個「同元件被重用」的問題——這裡
          // 補上 key 是為了保持三個分頁寫法一致、防禦未來如果改成共用
          // 元件時重蹈覆轍，不是因為現在真的有這個 bug。
          <MemberLivestreamOrders key="live" theme={{ badgeBg: tabThemes.live.badgeBg }} />
        )}
      </div>
    </section>
  );
}

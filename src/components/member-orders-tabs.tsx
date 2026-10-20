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
          <MemberOrderList orders={stockOrders} theme={{ badgeBg: tabThemes.stock.badgeBg }} emptyText="目前還沒有現貨訂單。" />
        ) : tab === "preorder" ? (
          <MemberOrderList orders={preorderOrders} theme={{ badgeBg: tabThemes.preorder.badgeBg }} emptyText="目前還沒有預購訂單。" />
        ) : (
          <MemberLivestreamOrders theme={{ badgeBg: tabThemes.live.badgeBg }} />
        )}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { MemberLivestreamOrders } from "@/components/member-livestream-orders";
import { MemberOrderList, type MemberOrder } from "@/components/member-order-list";

type SubTab = "shop" | "live";

const subTabs: { value: SubTab; label: string }[] = [
  { value: "shop", label: "網購訂單" },
  { value: "live", label: "連線下單" },
];

export function MemberOrdersTabs({ initialOrders }: { initialOrders: MemberOrder[] }) {
  const [tab, setTab] = useState<SubTab>("shop");

  return (
    <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-black text-penguin-gray">我的訂單</h2>
        <p className="text-sm font-bold text-gray-500">網購訂單與連線下單分開顯示。</p>
      </div>

      <div className="mt-5 flex gap-2 border-b-2 border-penguin-peach">
        {subTabs.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            className={`-mb-0.5 border-b-[3px] px-1 py-2.5 text-sm font-black transition ${
              tab === item.value ? "border-penguin-pink-dark text-penguin-pink-dark" : "border-transparent text-gray-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "shop" ? <MemberOrderList initialOrders={initialOrders} /> : <MemberLivestreamOrders />}
      </div>
    </section>
  );
}

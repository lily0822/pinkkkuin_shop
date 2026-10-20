"use client";

import { useState } from "react";
import { useCart } from "@/components/cart-provider";
import { usePreorderList } from "@/components/preorder-list-provider";

export type AddToPreorderListParams = {
  productId: string;
  variantId: string | null;
  quantity?: number;
};

export type AddToPreorderListResult = { ok: true } | { ok: false; message: string };

// 所有「加入預購清單」入口共用這份邏輯（商品詳情頁、商品卡、快速預覽、
// 預購分類頁都呼叫這個 hook），避免各自複製一份 fetch 邏輯又各自漏改。
// 成功後一律 refresh() 標頭徽章/抽屜資料，並打開抽屜停在預購清單分頁，
// 讓使用者立刻看到剛加入的項目。
export function useAddToPreorderList() {
  const cart = useCart();
  const preorderList = usePreorderList();
  const [submitting, setSubmitting] = useState(false);

  async function addToPreorderList({ productId, variantId, quantity = 1 }: AddToPreorderListParams): Promise<AddToPreorderListResult> {
    setSubmitting(true);
    try {
      const response = await fetch("/api/member/preorder-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, variantId, quantity }),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 401) {
        return { ok: false, message: "請先登入會員才能加入預購清單。" };
      }
      if (!response.ok || !result?.ok) {
        return { ok: false, message: result?.error || "加入失敗，請稍後再試。" };
      }
      preorderList.refresh();
      cart.openPreorderList();
      return { ok: true };
    } catch {
      return { ok: false, message: "加入失敗，請稍後再試。" };
    } finally {
      setSubmitting(false);
    }
  }

  return { addToPreorderList, submitting };
}

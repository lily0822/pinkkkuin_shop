"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type PreorderListItem = {
  id: string;
  productId: string;
  productName: string;
  variantSpec: string | null;
  seriesName: string | null;
  image: string;
  quantity: number;
  unitPrice: number;
  createdAt: string;
};

// unauthenticated/not_linked 不是噴錯誤的情況——這兩個是抽屜要分別顯示
// 「請先登入」/「請先完成 LINE 綁定」提示文字用的，跟 error（真的讀取
// 失敗，例如網路或伺服器錯誤）是不同的畫面。
export type PreorderAccessState = "loading" | "unauthenticated" | "not_linked" | "ok" | "error";

type SubmitResult = { orderNo: string; total: number } | null;

type PreorderListContextValue = {
  items: PreorderListItem[];
  count: number;
  accessState: PreorderAccessState;
  refresh: () => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  submit: () => Promise<void>;
  submitting: boolean;
  submitError: string;
  submitResult: SubmitResult;
  resetSubmitResult: () => void;
};

const PreorderListContext = createContext<PreorderListContextValue | null>(null);

type FetchOutcome =
  | { state: "unauthenticated"; items: PreorderListItem[] }
  | { state: "not_linked"; items: PreorderListItem[] }
  | { state: "ok"; items: PreorderListItem[] }
  | { state: "error"; items: PreorderListItem[] };

// 這個 provider 掛在 layout 最上層、整個 session 只會建立一次（不是每個
// 頁面各自掛一份），所以清單資料是真正共用的 React state——在抽屜裡
// 加減數量/刪除/送出，或是在預購商品頁按「加入」後呼叫 refresh()，
// 標頭徽章跟抽屜看到的是同一份 state，會立刻一起更新，不需要額外的
// polling 或依賴頁面切換（pathname）才重新抓一次。
export function PreorderListProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<PreorderListItem[]>([]);
  const [accessState, setAccessState] = useState<PreorderAccessState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<SubmitResult>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/member/preorder-list")
      .then(async (response): Promise<FetchOutcome> => {
        if (response.status === 401) return { state: "unauthenticated", items: [] };
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) return { state: "error", items: [] };
        if (result.linked === false) return { state: "not_linked", items: [] };
        return { state: "ok", items: (result.items || []) as PreorderListItem[] };
      })
      .then((outcome) => {
        if (cancelled) return;
        setAccessState(outcome.state);
        setItems(outcome.items);
      })
      .catch(() => {
        if (!cancelled) setAccessState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  function refresh() {
    // 清掉舊的送出結果——否則外部（例如預購商品頁按「加入」）觸發的
    // refresh 之後，抽屜底部會一直卡在上一次「登記成功」的畫面，跟這次
    // 新加進來的項目對不上。
    setSubmitResult(null);
    setRefreshToken((value) => value + 1);
  }

  function updateQuantity(id: string, quantity: number) {
    if (quantity < 1) return;
    const previous = items;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)));
    fetch(`/api/member/preorder-list/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    })
      .then((response) => {
        if (!response.ok) setItems(previous);
      })
      .catch(() => setItems(previous));
  }

  function removeItem(id: string) {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    fetch(`/api/member/preorder-list/${id}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) setItems(previous);
      })
      .catch(() => setItems(previous));
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/member/preorder-list/submit", { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setSubmitError(result?.error || "預購登記失敗，請稍後再試。");
        return;
      }
      setSubmitResult({ orderNo: result.order?.orderNo || "", total: Number(result.order?.total || 0) });
      setItems([]);
    } catch {
      setSubmitError("預購登記失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  function resetSubmitResult() {
    setSubmitResult(null);
  }

  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <PreorderListContext.Provider
      value={{ items, count, accessState, refresh, updateQuantity, removeItem, submit, submitting, submitError, submitResult, resetSubmitResult }}
    >
      {children}
    </PreorderListContext.Provider>
  );
}

export function usePreorderList() {
  const context = useContext(PreorderListContext);
  if (!context) throw new Error("usePreorderList must be used inside PreorderListProvider.");
  return context;
}

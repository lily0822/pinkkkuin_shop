"use client";

import { useMemo, useState } from "react";
import { useLiff } from "@/lib/line/use-liff";
import { LiveIdentityRow } from "@/components/live-identity-row";
import type { LiveCustomerIdentity } from "@/lib/line/live-customer-identity";

export type LiveOrderPurchaseChipTone = "pending" | "done" | "out" | "partial";
export type LiveOrderPaymentChipTone = "pending" | "paid" | "attention";
export type LiveOrderStatusChip = { label: string; tone: LiveOrderPurchaseChipTone | LiveOrderPaymentChipTone };

export type LiveOrderItem = {
  id: string;
  productName: string | null;
  photoUrl: string | null;
  quantity: number;
  unitPrice: number | null;
  purchasedQuantity: number | null;
  lockReason: "remitted" | "purchased" | null;
  purchaseChip: { label: string; tone: LiveOrderPurchaseChipTone };
  paymentChip: { label: string; tone: LiveOrderPaymentChipTone };
  group: "unpaid" | "paid";
  owed: number;
  refundDue: number;
  paidAmount: number;
  category: "general" | "gacha";
};

type DraftItem = LiveOrderItem & {
  originalQuantity: number;
  originalCategory: "general" | "gacha";
  removed: boolean;
  cancelled: boolean;
};

type LiveOrdersViewProps = {
  token: string;
  sessionName: string | null;
  unpaidTotal: number;
  paidTotal: number;
  refundDueTotal: number;
  unpaidItems: LiveOrderItem[];
  paidItems: LiveOrderItem[];
  orderQueryKeyword: string;
  identity: LiveCustomerIdentity;
};

const CHIP_TONE_STYLE: Record<
  LiveOrderPurchaseChipTone | LiveOrderPaymentChipTone,
  { background: string; borderColor: string; color: string }
> = {
  pending: { background: "#eef0f4", borderColor: "#d7dbe3", color: "#6b7280" },
  done: { background: "#e9f8ef", borderColor: "#8fd3ae", color: "#2f6b48" },
  out: { background: "#ffe9e9", borderColor: "#f0a5a5", color: "#b3443f" },
  partial: { background: "#fff9df", borderColor: "#f0dc8f", color: "#8a6d1f" },
  paid: { background: "#ffebf1", borderColor: "#ff8fb3", color: "#a84b6c" },
  attention: { background: "#fff4e6", borderColor: "#f3c08a", color: "#9a5b1f" },
};

function StatusChipBadge({ chip }: { chip: LiveOrderStatusChip }) {
  const style = CHIP_TONE_STYLE[chip.tone];
  return (
    <span
      className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold"
      style={{ backgroundColor: style.background, borderColor: style.borderColor, color: style.color }}
    >
      {chip.label}
    </span>
  );
}

// 純 React 局部 state 處理調數量/取消（跟 live-confirm-form.tsx 同一套
// 寫法），只有按「儲存修改」才打一次 API；已採買/已匯款的項目一律唯讀。
// 階段二（結算模型）起畫面分成「還沒匯款」「已匯款」兩個區塊，各自顯示
// 金額摘要，每個商品同時顯示採買狀態跟付款狀態兩個標籤（取代原本單一
// 標籤）。
export function LiveOrdersView({
  token,
  sessionName,
  unpaidTotal,
  paidTotal,
  refundDueTotal,
  unpaidItems,
  paidItems,
  orderQueryKeyword,
  identity,
}: LiveOrdersViewProps) {
  const initialItems = [...unpaidItems, ...paidItems];
  const [items, setItems] = useState<DraftItem[]>(
    initialItems.map((item) => ({
      ...item,
      originalQuantity: item.quantity,
      originalCategory: item.category,
      removed: false,
      cancelled: false,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const { trySendMessageAndClose } = useLiff();

  const visibleItems = useMemo(() => items.filter((item) => !item.cancelled), [items]);
  const visibleUnpaidItems = useMemo(() => visibleItems.filter((item) => item.group === "unpaid"), [visibleItems]);
  const visiblePaidItems = useMemo(() => visibleItems.filter((item) => item.group === "paid"), [visibleItems]);
  const dirtyItems = useMemo(
    () =>
      visibleItems.filter(
        (item) =>
          !item.lockReason &&
          (item.removed || item.quantity !== item.originalQuantity || item.category !== item.originalCategory),
      ),
    [visibleItems],
  );
  const canSave = dirtyItems.length > 0 && !saving;

  function updateQuantity(id: string, quantity: number) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)));
  }

  function toggleRemoved(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, removed: !item.removed } : item)));
  }

  function updateCategory(id: string, gacha: boolean) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, category: gacha ? "gacha" : "general" } : item)),
    );
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      const quantityChanges = dirtyItems
        .filter((item) => !item.removed)
        .map((item) => ({ id: item.id, quantity: item.quantity, category: item.category }));
      const cancelIds = dirtyItems.filter((item) => item.removed).map((item) => item.id);
      const response = await fetch("/api/live/orders/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, items: quantityChanges, cancelIds }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setSaveError("儲存失敗，請稍後再試一次。");
        return;
      }

      const results = (result.results || []) as { id: string; action: "quantity" | "cancel"; success: boolean }[];
      const failedIds = new Set(results.filter((row) => !row.success).map((row) => row.id));
      const succeededCancelIds = new Set(
        results.filter((row) => row.success && row.action === "cancel").map((row) => row.id),
      );
      const succeededQuantityIds = new Set(
        results.filter((row) => row.success && row.action === "quantity").map((row) => row.id),
      );

      setItems((current) =>
        current.map((item) => {
          if (succeededCancelIds.has(item.id)) return { ...item, cancelled: true };
          if (succeededQuantityIds.has(item.id))
            return { ...item, originalQuantity: item.quantity, originalCategory: item.category, removed: false };
          if (failedIds.has(item.id)) {
            // 送出時才發現這筆已經被標記採買/進入匯款流程，不能靜默失敗——
            // 把這筆鎖起來、復原成送出前的數量，明確告知客人。
            return { ...item, quantity: item.originalQuantity, removed: false, lockReason: "purchased" };
          }
          return item;
        }),
      );

      const baseNotice =
        failedIds.size > 0
          ? `有 ${failedIds.size} 項剛好已經被標記採買或進入匯款流程，無法修改，已經為您還原。`
          : "已儲存修改。";

      // 儲存修改這個 API 呼叫本身成功後，同樣用 LIFF sendMessages 幫客人
      // 送出「查詢訂單」讓機器人回最新清單——跟確認頁同一套邏輯，失敗/
      // 跳過都不影響儲存已經成功這件事，只是不會自動關閉視窗。
      const outcome = await trySendMessageAndClose(orderQueryKeyword);
      if (outcome === "sent") {
        setSaveNotice(baseNotice);
      } else {
        setSaveNotice(`${baseNotice}請回到 LINE 輸入「${orderQueryKeyword}」查看最新訂單。`);
      }
    } catch {
      setSaveError("儲存失敗，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  // 「還沒匯款」「已匯款」兩個區塊共用的單筆商品列——需要直接存取
  // updateQuantity/toggleRemoved 這兩個閉包，定義成元件內部函式而不是
  // 獨立 component，避免多一層 props 傳遞。
  function renderItemRow(item: DraftItem) {
    return (
      <div key={item.id} className="flex items-center gap-2.5 border-t border-[#f0f0f3] py-2.5 first:border-t-0">
        <div className="grid h-[62px] w-[62px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-penguin-cream text-xl text-penguin-gray">
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt={item.productName || "商品"} className="h-full w-full object-cover" />
          ) : (
            "P"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-penguin-gray">
            {item.productName || "商品"}
            {item.lockReason && item.category === "gacha" ? (
              <span className="ml-1 text-xs font-bold text-penguin-pink-dark">扭蛋</span>
            ) : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusChipBadge chip={item.purchaseChip} />
            <StatusChipBadge chip={item.paymentChip} />
            {item.unitPrice !== null ? (
              <span className="text-xs text-penguin-gray">單價 NT${item.unitPrice.toLocaleString("zh-TW")}</span>
            ) : null}
          </div>

          {item.lockReason ? (
            <p className="mt-1 text-xs font-bold text-gray-400">訂購數量 {item.quantity}</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <div className="inline-flex h-[30px] items-center overflow-hidden rounded-full border-[1.5px] border-penguin-pink-dark bg-white">
                <button
                  type="button"
                  aria-label="減少數量"
                  disabled={item.quantity <= 1 || item.removed}
                  onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                  className="grid h-full w-[30px] place-items-center bg-penguin-pink-light font-black text-penguin-gray disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  −
                </button>
                <span className="min-w-[30px] text-center text-sm font-black text-penguin-gray">{item.quantity}</span>
                <button
                  type="button"
                  aria-label="增加數量"
                  disabled={item.quantity >= 99 || item.removed}
                  onClick={() => updateQuantity(item.id, Math.min(99, item.quantity + 1))}
                  className="grid h-full w-[30px] place-items-center bg-penguin-pink-light font-black text-penguin-gray disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  ＋
                </button>
              </div>
              <label className="inline-flex h-[30px] items-center gap-1 text-xs font-bold text-penguin-gray">
                <input
                  type="checkbox"
                  checked={item.category === "gacha"}
                  disabled={item.removed}
                  onChange={(event) => updateCategory(item.id, event.target.checked)}
                  className="h-4 w-4 rounded border-penguin-pink-dark accent-penguin-pink-dark"
                />
                扭蛋
              </label>
              <button
                type="button"
                onClick={() => toggleRemoved(item.id)}
                className={`ml-auto shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-[#111] ${item.removed ? "bg-red-300" : "bg-red-100"}`}
              >
                {item.removed ? "已標記取消（再按一次還原）" : "取消這項"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="bg-white pb-28">
      <div className="mx-auto max-w-md px-4">
        <LiveIdentityRow lineName={identity.lineName} binding={identity.binding} />
        <h1 className="mt-2 text-center text-[17px] font-black text-penguin-gray">{sessionName ? sessionName : "目前訂單"}</h1>
        <p className="mt-1 text-center text-xs text-penguin-gray">已採買或已在匯款流程中的商品無法修改/取消。</p>

        {unpaidTotal > 0 ? (
          <div
            className="mt-3 rounded-xl border px-3 py-2 text-xs leading-6 text-penguin-gray"
            style={{ backgroundColor: "#fff9df", borderColor: "#f0dc8f" }}
          >
            尚未匯款金額：NT${unpaidTotal.toLocaleString("zh-TW")}
          </div>
        ) : null}
        {paidTotal > 0 ? (
          <div
            className="mt-2 rounded-xl border px-3 py-2 text-xs leading-6 text-penguin-gray"
            style={{ backgroundColor: "#ffebf1", borderColor: "#ff8fb3" }}
          >
            已匯款金額：NT${paidTotal.toLocaleString("zh-TW")}
            {refundDueTotal > 0 ? `・預計退款 NT$${refundDueTotal.toLocaleString("zh-TW")}` : ""}
          </div>
        ) : null}

        {saveError ? (
          <p role="status" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-500">
            {saveError}
          </p>
        ) : null}
        {saveNotice ? (
          <p role="status" className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-600">
            {saveNotice}
          </p>
        ) : null}

        <div className="mt-1">
          {visibleItems.length ? (
            <>
              {visibleUnpaidItems.length ? (
                <div>
                  <p className="mt-3 text-xs font-black text-penguin-gray">還沒匯款</p>
                  {visibleUnpaidItems.map((item) => renderItemRow(item))}
                </div>
              ) : null}
              {visiblePaidItems.length ? (
                <div>
                  <p className="mt-3 text-xs font-black text-penguin-gray">已匯款</p>
                  {visiblePaidItems.map((item) => renderItemRow(item))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-penguin-peach bg-penguin-cream/40 px-4 py-10 text-center text-sm text-penguin-gray">
              目前沒有訂單。
            </div>
          )}
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#eee] bg-white px-4 py-2.5"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <p className="text-xs text-penguin-gray">
            {dirtyItems.length > 0 ? `有 ${dirtyItems.length} 項尚未儲存` : "調整數量或按取消後，記得按儲存"}
          </p>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="shrink-0 rounded-full border-2 border-penguin-pink-dark bg-penguin-pink-light px-5 py-2.5 text-sm font-black text-penguin-gray disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {saving ? "儲存中..." : "儲存修改"}
          </button>
        </div>
      </div>
    </main>
  );
}

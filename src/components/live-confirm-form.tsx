"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiff } from "@/lib/line/use-liff";

export type LiveConfirmItem = {
  id: string;
  photoUrl: string | null;
};

type DraftItem = LiveConfirmItem & {
  quantity: number;
  unitPrice: string; // 保持字串，讓輸入框可以是空值/半輸入狀態，不強制轉數字
  removed: boolean;
};

type SubmittedItem = {
  id: string;
  productName: string | null;
  photoUrl: string | null;
  quantity: number;
  unitPrice: number;
};

type LiveConfirmFormProps = {
  token: string;
  sessionName: string | null;
  initialItems: LiveConfirmItem[];
  orderQueryKeyword: string;
};

// LIFF sendMessages 的結果——"idle" 代表還沒送出訂單或還在嘗試中。
// "sent" 之後頁面會被 liff.closeWindow() 關掉，"skipped"/"failed" 才會
// 留在完成畫面上，額外提示客人自己回 LINE 輸入查詢訂單關鍵字。
type LiffSendOutcome = "idle" | "sent" | "skipped" | "failed";

// 純 React 局部 state 管理所有互動（數量/單價/移除），完全不打任何網路
// 請求——調數量、填單價時不會整頁重新載入、輸入框不會失焦、捲動位置
// 不會跳走，只有按下「送出訂單」才打一次 API。
export function LiveConfirmForm({ token, sessionName, initialItems, orderQueryKeyword }: LiveConfirmFormProps) {
  const [items, setItems] = useState<DraftItem[]>(
    initialItems.map((item) => ({ ...item, quantity: 1, unitPrice: "", removed: false })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState<{ items: SubmittedItem[]; sessionName: string } | null>(null);
  const { trySendMessageAndClose } = useLiff();
  const [liffOutcome, setLiffOutcome] = useState<LiffSendOutcome>("idle");

  // 送出訂單成功後（submitted 從 null 變成有值）才嘗試用 LIFF 送出
  // 「查詢訂單」——完成畫面（下面的 LiveConfirmDone）已經先渲染出來了，
  // 這一步只是錦上添花，失敗/跳過都不影響已經送出的訂單本身。
  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    trySendMessageAndClose(orderQueryKeyword).then((result) => {
      if (!cancelled) setLiffOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [submitted, trySendMessageAndClose, orderQueryKeyword]);

  const visibleItems = useMemo(() => items.filter((item) => !item.removed), [items]);
  const missingPriceCount = useMemo(
    () => visibleItems.filter((item) => !isValidPrice(item.unitPrice)).length,
    [visibleItems],
  );
  const totalQuantity = useMemo(() => visibleItems.reduce((sum, item) => sum + item.quantity, 0), [visibleItems]);
  const totalAmount = useMemo(
    () =>
      visibleItems.reduce((sum, item) => {
        const price = isValidPrice(item.unitPrice) ? Number(item.unitPrice) : 0;
        return sum + price * item.quantity;
      }, 0),
    [visibleItems],
  );

  const canSubmit = visibleItems.length > 0 && missingPriceCount === 0 && !submitting;

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, removed: true } : item)));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const removeIds = items.filter((item) => item.removed).map((item) => item.id);
      const payloadItems = visibleItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      }));
      const response = await fetch("/api/live/confirm/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, items: payloadItems, removeIds }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setSubmitError(result?.error === "session_not_active" ? "這場連線已經結束，沒辦法再送出訂單了。" : "送出失敗，請稍後再試一次。");
        return;
      }
      setSubmitted({ items: result.items || [], sessionName: result.sessionName || sessionName || "" });
    } catch {
      setSubmitError("送出失敗，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <LiveConfirmDone
        sessionName={submitted.sessionName}
        items={submitted.items}
        liffOutcome={liffOutcome}
        orderQueryKeyword={orderQueryKeyword}
      />
    );
  }

  return (
    <main className="min-h-screen bg-penguin-cream pb-32">
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="text-xl font-black text-penguin-gray">確認訂單</h1>
        <p className="mt-1 text-sm text-penguin-gray">
          {sessionName ? `${sessionName}・` : ""}預設每個商品 1 個，不是商品的照片請按移除
        </p>

        <div className="mt-4 rounded-2xl border-2 px-4 py-3 text-sm leading-6 text-penguin-gray" style={{ backgroundColor: "#fff9df", borderColor: "#f0dc8f" }}>
          每張都要填單價，請照照片上的價格填。賣家會再核對，如果有出入，會以賣家確認的價格為準。
        </div>

        {submitError ? (
          <p role="status" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-500">
            {submitError}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {visibleItems.length ? (
            visibleItems.map((item, index) => (
              <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-penguin-peach bg-white p-3">
                <div className="grid h-[68px] w-[68px] shrink-0 place-items-center overflow-hidden rounded-xl bg-penguin-cream text-xl text-penguin-gray">
                  {item.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photoUrl} alt={`照片 ${index + 1}`} className="h-full w-full object-cover" />
                  ) : (
                    "P"
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-black text-penguin-gray">照片 {index + 1}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-9 items-center overflow-hidden rounded-full border-2 border-penguin-pink bg-white">
                      <button
                        type="button"
                        aria-label="減少數量"
                        disabled={item.quantity <= 1}
                        onClick={() => updateItem(item.id, { quantity: Math.max(1, item.quantity - 1) })}
                        className="grid h-full w-8 place-items-center font-black text-penguin-gray disabled:cursor-not-allowed disabled:text-gray-300"
                      >
                        -
                      </button>
                      <span className="min-w-7 text-center text-sm font-black text-penguin-gray">{item.quantity}</span>
                      <button
                        type="button"
                        aria-label="增加數量"
                        disabled={item.quantity >= 99}
                        onClick={() => updateItem(item.id, { quantity: Math.min(99, item.quantity + 1) })}
                        className="grid h-full w-8 place-items-center font-black text-penguin-gray disabled:cursor-not-allowed disabled:text-gray-300"
                      >
                        +
                      </button>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="單價（必填）"
                      value={item.unitPrice}
                      onChange={(event) => updateItem(item.id, { unitPrice: event.target.value.replace(/[^0-9]/g, "") })}
                      className={`h-9 w-28 rounded-full border-2 px-3 text-sm font-black text-penguin-gray outline-none focus:border-penguin-pink-dark ${
                        isValidPrice(item.unitPrice) ? "border-penguin-peach" : "border-red-200 bg-red-50"
                      }`}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="shrink-0 text-xs font-bold text-gray-400 hover:text-red-500"
                >
                  移除
                </button>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-penguin-peach bg-white px-4 py-10 text-center text-sm text-penguin-gray">
              目前沒有待確認的照片。
            </div>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-penguin-peach bg-white px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-penguin-gray">
              共 {visibleItems.length} 種・{totalQuantity} 件
            </p>
            {missingPriceCount > 0 ? (
              <p className="text-xs font-bold text-red-500">還有 {missingPriceCount} 樣沒填單價，填完才能送出</p>
            ) : visibleItems.length > 0 ? (
              <p className="text-xs text-penguin-gray">總金額 NT${totalAmount.toLocaleString("zh-TW")}（單價是你填的，賣家核對後以實際價格為準）</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="shrink-0 rounded-full bg-penguin-pink-dark px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submitting ? "送出中..." : "送出訂單"}
          </button>
        </div>
      </div>
    </main>
  );
}

function isValidPrice(value: string) {
  if (!value) return false;
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function LiveConfirmDone({
  sessionName,
  items,
  liffOutcome,
  orderQueryKeyword,
}: {
  sessionName: string;
  items: SubmittedItem[];
  liffOutcome: LiffSendOutcome;
  orderQueryKeyword: string;
}) {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  // "sent" 的話頁面馬上會被 liff.closeWindow() 關掉，這段提示幾乎不會
  // 被看到；"skipped"（不在 LINE 內開啟、或沒設定 LIFF）/"failed"
  // （初始化失敗、客人拒絕授權、sendMessages 本身失敗）才需要客人自己
  // 動手——不能讓客人以為訂單沒送出成功，所以文字要跟「訂單已經記錄」
  // 這件事分開講。
  const showManualQueryHint = liffOutcome === "skipped" || liffOutcome === "failed";
  return (
    <main className="min-h-screen bg-penguin-cream px-4 py-8">
      <div className="mx-auto max-w-md">
        <p className="text-base font-black text-penguin-gray">以下商品已記錄在「{sessionName}」訂單中：</p>
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-penguin-peach bg-white p-3">
              <div className="grid h-[68px] w-[68px] shrink-0 place-items-center overflow-hidden rounded-xl bg-penguin-cream text-xl text-penguin-gray">
                {item.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photoUrl} alt={item.productName || "商品"} className="h-full w-full object-cover" />
                ) : (
                  "P"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-penguin-gray">{item.productName || "商品"}</p>
                <p className="mt-1 text-xs text-penguin-gray">
                  數量 {item.quantity}・你填的單價 NT${item.unitPrice.toLocaleString("zh-TW")}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border-2 border-penguin-peach bg-white p-4 text-center">
          <p className="text-lg font-black text-penguin-gray">總金額 NT${total.toLocaleString("zh-TW")}</p>
          {showManualQueryHint ? (
            <p className="mt-2 text-xs text-penguin-gray">訂單已送出，請回到 LINE 輸入「{orderQueryKeyword}」查看最新訂單。</p>
          ) : (
            <p className="mt-2 text-xs text-penguin-gray">採買結果和修改、取消，之後都可以從選單的「查詢訂單」查看。</p>
          )}
        </div>
      </div>
    </main>
  );
}

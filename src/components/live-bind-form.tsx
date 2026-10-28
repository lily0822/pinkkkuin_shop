"use client";

import { useEffect, useState } from "react";
import { useLiff } from "@/lib/line/use-liff";
import { LiveIdentityRow } from "@/components/live-identity-row";
import type { LiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import {
  normalizeLiveBindingValue,
  validateLiveBindingValue,
  type LiveBindingType,
} from "@/lib/line/live-identity-validation";

export type LiveBindCurrent = { type: LiveBindingType; value: string };

type LiveBindFormProps = {
  token: string;
  mode: "bind" | "edit";
  current: LiveBindCurrent | null;
  identity: LiveCustomerIdentity;
  next: "order" | null;
  orderKeyword: string | null;
};

type Screen = "notice" | "form" | "success";

const TYPE_LABELS: Record<LiveBindingType, string> = { nickname: "社群暱稱", ig: "IG 帳號" };
const TAG_STYLE: Record<LiveBindingType, { background: string; borderColor: string; color: string }> = {
  nickname: { background: "#e9f8ef", borderColor: "#8fd3ae", color: "#2f6b48" },
  ig: { background: "#f3e8ff", borderColor: "#d4b4f5", color: "#6b3fa0" },
};

function displayValue(binding: LiveBindCurrent) {
  return binding.type === "ig" ? `@${binding.value}` : `「${binding.value}」`;
}

// 純 React 局部 state 管理整個流程（通知畫面→表單→成功畫面），完全不
// 整頁重新載入——跟 live-confirm-form.tsx/live-orders-view.tsx 同一套
// 寫法。mode/current 決定一開始顯示哪個畫面：
//   mode=bind 且已經有綁定 → "notice"（你已經綁定過了，按【修改】進表單）
//   mode=edit 且還沒有綁定 → "notice"（你還沒有綁定，按【綁定】進表單）
//   其餘兩種組合 → 直接進 "form"
// LIFF sendMessages 的結果——只有 next="order" 時才會用到，"idle" 代表
// 還沒綁定成功或還在嘗試中。"sent" 之後頁面會被 liff.closeWindow() 關掉
// （機器人收到「我要下單」後走正常下單流程）；"skipped"/"failed" 才會
// 留在成功畫面上，額外提示客人自己回 LINE 輸入下單關鍵字——sendMessages
// 失敗或不在 LIFF 內，絕不能讓綁定本身跟著失敗，這一步純粹是錦上添花。
type LiffSendOutcome = "idle" | "sent" | "skipped" | "failed";

export function LiveBindForm({ token, mode, current, identity, next, orderKeyword }: LiveBindFormProps) {
  const [binding, setBinding] = useState<LiveBindCurrent | null>(current);
  const [screen, setScreen] = useState<Screen>(() => {
    if (mode === "bind" && current) return "notice";
    if (mode === "edit" && !current) return "notice";
    return "form";
  });
  const [formMode, setFormMode] = useState<"bind" | "edit">(current ? "edit" : "bind");
  const [formType, setFormType] = useState<LiveBindingType>(current?.type || "nickname");
  const [formValue, setFormValue] = useState(current?.value || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successBinding, setSuccessBinding] = useState<LiveBindCurrent | null>(null);
  const { status: liffStatus, tryClose, trySendMessageAndClose } = useLiff();
  const [liffOutcome, setLiffOutcome] = useState<LiffSendOutcome>("idle");

  // 只有 next="order"（從「先綁定一下社群帳號」那張卡片進來）才自動
  // 傳下單關鍵字——沒有 next=order 的一般綁定行為完全不變，不自動傳
  // 任何訊息（跟確認頁/查詢頁的「送出後自動查詢」刻意不同）。
  useEffect(() => {
    if (!successBinding || next !== "order" || !orderKeyword) return;
    let cancelled = false;
    trySendMessageAndClose(orderKeyword).then((result) => {
      if (!cancelled) setLiffOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [successBinding, next, orderKeyword, trySendMessageAndClose]);

  const canSubmit = Boolean(normalizeLiveBindingValue(formType, formValue)) && !submitting;

  function openForm(nextFormMode: "bind" | "edit") {
    setFormMode(nextFormMode);
    setFormType(binding?.type || "nickname");
    setFormValue(binding?.value || "");
    setError("");
    setScreen("form");
  }

  function selectType(type: LiveBindingType) {
    setFormType(type);
    setError("");
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const validation = validateLiveBindingValue(formType, formValue);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/live/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type: formType, value: validation.value, mode: formMode }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setError(result?.error || "綁定失敗，請稍後再試一次。");
        return;
      }
      const next: LiveBindCurrent = { type: result.binding.type, value: result.binding.value };
      setBinding(next);
      setSuccessBinding(next);
      setScreen("success");
    } catch {
      setError("綁定失敗，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

  if (screen === "success" && successBinding) {
    return (
      <main className="bg-white px-4 py-6">
        <div className="mx-auto max-w-md">
          <LiveIdentityRow lineName={identity.lineName} binding={successBinding} />
          <div className="mt-6 text-center">
            <div className="text-[42px] leading-none text-[#2f9e5f]" aria-hidden="true">
              ✓
            </div>
            <h1 className="mt-2 text-lg font-black text-penguin-gray">{formMode === "edit" ? "修改完成" : "綁定完成"}</h1>
            <p className="mt-2 text-sm text-penguin-gray">賣家之後會看到你是：</p>
            <span
              className="mt-2 inline-block rounded-full border-2 px-4 py-1.5 text-base font-black"
              style={{
                backgroundColor: TAG_STYLE[successBinding.type].background,
                borderColor: TAG_STYLE[successBinding.type].borderColor,
                color: TAG_STYLE[successBinding.type].color,
              }}
            >
              {displayValue(successBinding)}
            </span>
            {next === "order" && (liffOutcome === "skipped" || liffOutcome === "failed") ? (
              <p className="mt-3 text-sm font-bold text-penguin-pink-dark">請回到 LINE 輸入「我要下單」開始下單</p>
            ) : null}
            {liffStatus === "ready" ? (
              <>
                <p className="mt-4 text-xs text-penguin-gray">可以按上面的 ✕ 或下面的按鈕，回到 LINE 了。</p>
                <button
                  type="button"
                  onClick={() => tryClose()}
                  className="mt-4 rounded-full border-2 border-penguin-pink-dark bg-penguin-pink-light px-6 py-2.5 text-sm font-black text-penguin-gray"
                >
                  回到 LINE
                </button>
              </>
            ) : (
              <p className="mt-4 text-xs text-penguin-gray">請關閉這個頁面，回到 LINE 繼續。</p>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (screen === "notice") {
    const hasBinding = Boolean(binding);
    return (
      <main className="bg-white px-4 py-6">
        <div className="mx-auto max-w-md">
          <LiveIdentityRow lineName={identity.lineName} binding={binding} />
          <div className="mt-6 text-center">
            <h1 className="text-[17px] font-black text-penguin-gray">{hasBinding ? "你已經綁定過了" : "你還沒有綁定"}</h1>
            <p className="mt-2 text-sm leading-6 text-penguin-gray">
              {hasBinding && binding
                ? `目前綁定的是：${binding.type === "ig" ? "IG " : "社群暱稱"}${displayValue(binding)}。如果要更換，請按【修改】。`
                : "還沒有可以修改的資料，先來綁定吧。"}
            </p>
            <button
              type="button"
              onClick={() => openForm(hasBinding ? "edit" : "bind")}
              className="mt-4 rounded-full border-2 border-penguin-pink-dark bg-penguin-pink-light px-6 py-2.5 text-sm font-black text-penguin-gray"
            >
              {hasBinding ? "修改" : "綁定"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-white pb-24">
      <div className="mx-auto max-w-md px-4">
        <LiveIdentityRow lineName={identity.lineName} binding={binding} />
        <h1 className="mt-2 text-center text-[17px] font-black text-penguin-gray">
          {formMode === "edit" ? "修改綁定資料" : "綁定社群帳號"}
        </h1>
        <p className="mt-1 text-center text-xs text-penguin-gray">
          {formMode === "edit" ? "修改後立刻生效，賣家會看到新的資料。" : "填一次就好，賣家會知道你是社群裡的誰。"}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["nickname", "ig"] as LiveBindingType[]).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={formType === type}
              onClick={() => selectType(type)}
              className={`rounded-xl border-2 py-2.5 text-sm font-bold ${
                formType === type
                  ? "border-penguin-pink-dark bg-penguin-pink-light text-penguin-gray"
                  : "border-[#e3e3e8] bg-white text-penguin-gray"
              }`}
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor="bind-value-input" className="mb-1.5 block text-sm font-bold text-penguin-gray">
            {formType === "ig" ? "你的 IG 帳號" : "你在社群裡的暱稱"}
          </label>
          <input
            id="bind-value-input"
            type="text"
            autoComplete="off"
            maxLength={40}
            placeholder={formType === "ig" ? "例如：mei_daily" : "例如：小美Mei"}
            value={formValue}
            onChange={(event) => {
              setFormValue(event.target.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            className="w-full rounded-xl border-2 border-penguin-peach px-3.5 py-2.5 text-base text-penguin-gray outline-none focus:border-penguin-pink-dark"
          />
        </div>

        <p className="mt-2 text-xs leading-6 text-penguin-gray">
          {formType === "ig" ? "不用加 @，大小寫都可以，系統會自動整理。" : "請填你平常在社群裡使用的名字，賣家才認得出你。"}
        </p>

        {error ? (
          <p role="alert" className="mt-2 text-sm font-bold text-red-500">
            {error}
          </p>
        ) : null}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#eee] bg-white px-4 py-2.5"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-full border-2 border-penguin-pink-dark bg-penguin-pink-light px-5 py-3 text-sm font-black text-penguin-gray disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {submitting ? "送出中..." : formMode === "edit" ? "儲存修改" : "綁定"}
          </button>
        </div>
      </div>
    </main>
  );
}

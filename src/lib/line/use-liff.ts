"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Liff } from "@line/liff";

// LIFF 這次只負責「卡片按鈕用 LIFF 網址開半屏視窗」+「送出/儲存成功後
// 幫客人送一則『查詢訂單』文字、機器人用回覆自動顯示最新清單」，不負責
// 身分驗證（仍然沿用既有的簽章 token，見 livestream-magic-link.ts）。
// 任何一步失敗都不能影響送出訂單/儲存修改這個主流程本身——這個 hook
// 回傳的狀態只拿來決定「要不要多做這個錦上添花的動作」，從來不是
// gating 條件。
//
// 用動態 import('@line/liff') 而不是檔案最上面的 top-level import：
// 這個 SDK 假設瀏覽器環境（building 時會存取 window/document 等全域
// 物件），如果寫成一般 import，Next.js 的伺服器端渲染階段會在 Node
// 環境執行到這段程式碼而噴錯；動態 import 確保只有真的執行到
// useEffect（已經在瀏覽器裡、元件掛載後）才會載入並執行這個模組。
export type LiffStatus = "initializing" | "unavailable" | "ready" | "failed";

export function useLiff() {
  const [status, setStatus] = useState<LiffStatus>("initializing");
  const liffRef = useRef<Liff | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        // 沒設定 LIFF_ID（例如本機開發、或這個環境還沒設定）——直接當作
        // 「不在 LIFF 環境」，整個流程退回原本的直接網址/純完成畫面，不嘗
        // 試呼叫任何 LIFF API。
        if (!cancelled) setStatus("unavailable");
        return;
      }

      try {
        const liffModule = (await import("@line/liff")).default;
        await liffModule.init({ liffId });
        if (cancelled) return;
        if (!liffModule.isInClient()) {
          // 客人是用一般瀏覽器開這個連結（不是從官方帳號卡片按鈕點進
          // 來），LIFF 不能 sendMessages，退回一般完成畫面。
          setStatus("unavailable");
          return;
        }
        liffRef.current = liffModule;
        setStatus("ready");
      } catch {
        // 初始化失敗、或客人在授權畫面按了拒絕——不能讓客人卡住，一律
        // 當作不在 LIFF 環境處理。
        if (!cancelled) setStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 送一則文字訊息給官方帳號（算客人自己傳的，機器人用回覆回覆，不算
  // LINE 推播額度），成功後關閉 LIFF 視窗回到聊天室。status 不是
  // "ready" 時直接跳過，不嘗試呼叫任何 LIFF API。
  const trySendMessageAndClose = useCallback(
    async (text: string): Promise<"sent" | "skipped" | "failed"> => {
      if (status !== "ready" || !liffRef.current) return "skipped";
      try {
        await liffRef.current.sendMessages([{ type: "text", text }]);
        liffRef.current.closeWindow();
        return "sent";
      } catch {
        return "failed";
      }
    },
    [status],
  );

  return { status, trySendMessageAndClose };
}

"use client";

import { useEffect, useState } from "react";
import { LiveErrorScreen } from "@/components/live-error-screen";

// LIFF 的 Endpoint URL 設定成 https://xxx.vercel.app/live。客人第一次開
// LIFF（還沒授權過）時，LINE 會先跑授權流程，授權完成後導回「Endpoint
// URL 本身」並帶上 liff.state 參數（內容是原本要去的子路徑與查詢，例如
// /confirm?token=...），而不是直接導到子路徑——所以 /live 本身一定要有
// 一個頁面，負責：1. 先讀走 liff.state（liff.init() 之後 SDK 會把它從網址
// 上清掉）；2. 跑 liff.init() 完成授權收尾；3. 再導向真正的頁面。沒有這個
// 入口頁，客人授權完就會看到 404。
const ALLOWED_TARGET = /^\/(confirm|orders|bind)(\?.*)?$/;

export function LiveEntry() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const state = new URLSearchParams(window.location.search).get("liff.state") || "";
      const target = ALLOWED_TARGET.test(state) ? state : "";

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (liffId && target) {
        try {
          const liff = (await import("@line/liff")).default;
          await liff.init({ liffId });
        } catch {
          // 授權收尾失敗不擋導向——目標頁面自己的 useLiff 還會再初始化一次，
          // 真的不行會退回一般完成畫面，主流程不依賴 LIFF。
        }
      }

      if (cancelled) return;
      if (target) {
        window.location.replace(`/live${target}`);
        return;
      }
      setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <LiveErrorScreen title="找不到頁面" message="請回到 LINE，重新按卡片上的按鈕。" />;
  }

  return (
    <main className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <p className="text-sm font-bold text-penguin-gray" role="status">載入中…</p>
    </main>
  );
}

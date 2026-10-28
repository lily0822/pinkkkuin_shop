import "server-only";

import { getSiteOrigin } from "@/lib/supabase/config";

// 機器人卡片上開 /live/confirm、/live/orders 的按鈕改用 LIFF 網址——LIFF
// 會把 {LIFF_ID} 後面的子路徑/查詢參數原樣接在 Endpoint URL 後面
// （Endpoint URL 設定成 https://xxx.vercel.app/live，所以
// https://liff.line.me/{id}/confirm?token=X 對應到
// https://xxx.vercel.app/live/confirm?token=X）。NEXT_PUBLIC_LIFF_ID
// 沒設定時（例如本機開發、或這個環境還沒設定 LIFF）直接退回原本的直接
// 網址，不讓整個下單/查詢流程壞掉——這個 fallback 的重要性等同於
// LIFF 從頭到尾都是「錦上添花」，不是必要路徑。
export function buildLiveLiffUrl(subPath: "confirm" | "orders", token: string): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  const encodedToken = encodeURIComponent(token);
  if (!liffId) {
    return `${getSiteOrigin()}/live/${subPath}?token=${encodedToken}`;
  }
  return `https://liff.line.me/${liffId}/${subPath}?token=${encodedToken}`;
}

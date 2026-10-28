import "server-only";

import crypto from "crypto";

// 連線代購下單改版：免登入確認頁/修改頁連結，照抄 preorder-magic-link.ts
// 的簽章機制（同一套做法，這裡重新寫一份而不是共用程式碼，理由也一樣：
// 兩邊是不同 feature，用途/到期時間不同，沒有必要耦合在一起）。
//
// purpose 限 "order-confirm"（/live/confirm，第一階段）、"order-edit"
// （/live/orders，第二階段）、"bind"（/live/bind，社群綁定功能）——三種
// token 不可互相通用，也不可以拿來當會員登入憑證：payload 只放
// lineUserId，不放 user_id/session，跟會員系統完全無關。
//
// 到期時間比預購的 10 分鐘長很多（客人填單價會花時間），兩種都給 60
// 分鐘。沒有一次性/黑名單機制，純時效到期——這個連結是回覆給本人的
// LINE 訊息裡的按鈕，不是公開貼出去的東西。
const TTL_MS = 60 * 60 * 1000;

export type LivestreamMagicLinkPurpose = "order-confirm" | "order-edit" | "bind";

type LivestreamMagicLinkPayload = {
  lineUserId: string;
  purpose: LivestreamMagicLinkPurpose;
  issuedAt: number;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

// 跟 preorder-magic-link.ts 的 secret() 讀同一組環境變數 fallback 鏈，保持
// 一致——沒有共用程式碼，是刻意重新寫一份小函式。
function secret() {
  const value = env("LINE_LOGIN_STATE_SECRET") || env("BACKEND_SESSION_SECRET") || env("SUPABASE_ANON_KEY");
  if (!value) throw new Error("Livestream magic link secret is not configured.");
  return value;
}

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createLivestreamMagicLink(lineUserId: string, purpose: LivestreamMagicLinkPurpose): string {
  const payload: LivestreamMagicLinkPayload = {
    lineUserId,
    purpose,
    issuedAt: Date.now(),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

// expectedPurpose 一定要帶——order-confirm 的 token 不能拿去當 order-edit
// 用，反之亦然，即使簽章本身有效。
export function verifyLivestreamMagicLink(
  token: string,
  expectedPurpose: LivestreamMagicLinkPurpose,
): LivestreamMagicLinkPayload | null {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  let payload: LivestreamMagicLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LivestreamMagicLinkPayload;
  } catch {
    return null;
  }

  if (!payload.lineUserId || typeof payload.issuedAt !== "number") return null;
  if (payload.purpose !== expectedPurpose) return null;
  if (Date.now() - payload.issuedAt > TTL_MS) return null;
  return payload;
}

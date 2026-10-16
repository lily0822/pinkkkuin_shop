import "server-only";

import crypto from "crypto";

// 第一期先只做「連結能免登入直接生 session」這個機制本身；真正從
// webhook 回覆裡把連結送出去是第二期的事。

// 10 分鐘，跟現有 LINE OAuth state cookie（src/lib/line/login.ts 的
// STATE_COOKIE_MAX_AGE）同一個慣例值，不是另外挑的。已經跟使用者
// 確認過：這個連結是私訊給本人的，不是公開貼出去的東西，只做時間
// 到期就好，不用再開一張表做真正的一次性/用過即失效。
const TTL_MS = 10 * 60 * 1000;

type PreorderMagicLinkPayload = {
  lineUserId: string;
  returnTo: string;
  issuedAt: number;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

// 跟 src/lib/line/login.ts 的 stateSecret() 讀同一組環境變數 fallback
// 鏈，保持一致；那支沒有 export，這裡重新寫一份一樣的小函式，不特地
// 為了共用兩三行邏輯去改動既有檔案的對外介面。
function secret() {
  const value = env("LINE_LOGIN_STATE_SECRET") || env("BACKEND_SESSION_SECRET") || env("SUPABASE_ANON_KEY");
  if (!value) throw new Error("Preorder magic link secret is not configured.");
  return value;
}

function base64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function isSafeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

export function createPreorderMagicLink(lineUserId: string, returnTo: string): string {
  const payload: PreorderMagicLinkPayload = {
    lineUserId,
    returnTo: isSafeReturnTo(returnTo) ? returnTo : "/member/orders",
    issuedAt: Date.now(),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPreorderMagicLink(token: string): PreorderMagicLinkPayload | null {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  let payload: PreorderMagicLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreorderMagicLinkPayload;
  } catch {
    return null;
  }

  if (!payload.lineUserId || typeof payload.issuedAt !== "number") return null;
  if (!isSafeReturnTo(payload.returnTo)) return null;
  if (Date.now() - payload.issuedAt > TTL_MS) return null;
  return payload;
}

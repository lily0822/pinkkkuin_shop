export type AuthRedirectMessage = { kind: "success" | "error"; text: string };

const oauthMessages: Record<string, AuthRedirectMessage> = {
  "email-exists": {
    kind: "error",
    text: "這個 email 已經註冊過，請先用密碼登入，再到「登入與安全」頁面自行連結 Google。",
  },
  "signup-disabled": { kind: "error", text: "會員註冊暫未開放。" },
  failed: { kind: "error", text: "Google 登入失敗，請稍後再試。" },
  "link-disabled": { kind: "error", text: "目前尚未開放連結 Google，請稍後再試。" },
};

const lineLoginMessages: Record<string, AuthRedirectMessage> = {
  "not-bound": {
    kind: "error",
    text: "這個 LINE 帳號尚未綁定會員，請先用 email 或 Google 登入後再到會員中心綁定。",
  },
  "not-configured": { kind: "error", text: "LINE 登入目前尚未開放。" },
  failed: { kind: "error", text: "LINE 登入失敗，請稍後再試。" },
  disabled: { kind: "error", text: "會員帳號目前已停用。" },
};

export function getOAuthMessage(value: string | undefined | null): AuthRedirectMessage | null {
  if (!value) return null;
  return oauthMessages[value] || null;
}

export function getLineLoginMessage(value: string | undefined | null): AuthRedirectMessage | null {
  if (!value) return null;
  return lineLoginMessages[value] || null;
}

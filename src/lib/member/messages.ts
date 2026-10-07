export type AccountBannerMessage = { kind: "success" | "error"; text: string };

const lineBindingMessages: Record<string, AccountBannerMessage> = {
  linked: { kind: "success", text: "LINE 已成功綁定。" },
  "already-linked": { kind: "success", text: "這個 LINE 帳號已經綁定過了。" },
  "line-already-linked": { kind: "error", text: "這個 LINE 帳號已經綁定在其他會員，請改用別的 LINE 帳號。" },
  "member-already-linked": { kind: "error", text: "您的會員已經綁定其他 LINE 帳號，請先解除綁定後再重新綁定。" },
  "link-failed": { kind: "error", text: "LINE 綁定失敗，請稍後再試。" },
  "invalid-state": { kind: "error", text: "LINE 綁定逾時或驗證失敗，請重新操作。" },
  disabled: { kind: "error", text: "會員帳號目前已停用。" },
  "not-configured": { kind: "error", text: "LINE 綁定目前尚未開放。" },
  "login-required": { kind: "error", text: "請先登入會員。" },
};

const googleBindingMessages: Record<string, AccountBannerMessage> = {
  "link-disabled": { kind: "error", text: "目前尚未開放連結 Google，請稍後再試。" },
  "link-failed": { kind: "error", text: "Google 綁定失敗，請稍後再試。" },
};

export function getLineBindingMessage(value: string | undefined | null): AccountBannerMessage | null {
  if (!value) return null;
  return lineBindingMessages[value] || null;
}

export function getGoogleBindingMessage(value: string | undefined | null): AccountBannerMessage | null {
  if (!value) return null;
  return googleBindingMessages[value] || null;
}

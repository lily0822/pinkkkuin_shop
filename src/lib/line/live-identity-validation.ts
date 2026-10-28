// 社群綁定（暱稱／IG）的正規化＋格式驗證——純函式，前端（即時提示）跟
// 後端（/api/live/bind，權威驗證，不信任前端）共用同一份邏輯，不會
// 兩邊各寫一套、規則慢慢飄走。沒有任何 server-only 相依，可以直接被
// "use client" 元件 import。
export type LiveBindingType = "nickname" | "ig";

// 暱稱：去頭尾空白、連續空白壓成一個，保留使用者輸入的大小寫與符號。
// IG：去掉開頭的 @（可能不只一個）、移除所有空白、轉小寫。
export function normalizeLiveBindingValue(type: LiveBindingType, raw: string): string {
  if (type === "ig") {
    return raw.replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
  }
  return raw.replace(/\s+/g, " ").trim();
}

export type LiveBindingValidation = { ok: true; value: string } | { ok: false; message: string };

export function validateLiveBindingValue(type: LiveBindingType, raw: string): LiveBindingValidation {
  const value = normalizeLiveBindingValue(type, raw);
  if (!value) {
    return { ok: false, message: type === "ig" ? "請輸入你的 IG 帳號。" : "請輸入你的社群暱稱。" };
  }
  if (type === "ig") {
    if (!/^[a-z0-9._]{1,30}$/.test(value)) {
      return { ok: false, message: "IG 帳號只能有英文字母、數字、底線和點，最多 30 個字。" };
    }
  } else if (value.length > 20) {
    return { ok: false, message: "社群暱稱最多 20 個字。" };
  }
  return { ok: true, value };
}

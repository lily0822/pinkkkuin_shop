import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 店家自己的收款帳號資訊 (社群連線訂單自助匯款流程用) — 沿用
// community-notification-templates.ts 的 schedule_settings KV 模式，不開
// 新資料表。改成三個固定銀行的獨立帳號欄位（銀行名稱固定，帳號後台可
// 編輯），取代原本的一整段自由文字——因為客人「我要匯款」收到的訊息
// 這輪改成用 LINE Flex 的 clipboard 按鈕讓客人一鍵複製帳號，三顆按鈕
// 各自需要一個獨立的帳號字串，不能再塞在一段自由格式文字裡解析。
export type LivestreamBankAccountKey = "zhongxin" | "fubon" | "cathay";

export const LIVESTREAM_BANK_ACCOUNT_KEYS: LivestreamBankAccountKey[] = ["zhongxin", "fubon", "cathay"];

export const LIVESTREAM_BANK_ACCOUNT_LABELS: Record<LivestreamBankAccountKey, string> = {
  zhongxin: "中信",
  fubon: "富邦",
  cathay: "國泰",
};

export type LivestreamBankAccounts = Record<LivestreamBankAccountKey, string>;

const SETTINGS_TYPE = "community-livestream-bank-info";
const MAX_ACCOUNT_LENGTH = 100;

function sanitizeAccounts(input: Partial<Record<LivestreamBankAccountKey, unknown>>): LivestreamBankAccounts {
  const result = {} as LivestreamBankAccounts;
  LIVESTREAM_BANK_ACCOUNT_KEYS.forEach((key) => {
    const value = input[key];
    result[key] = typeof value === "string" ? value.trim().slice(0, MAX_ACCOUNT_LENGTH) : "";
  });
  return result;
}

export async function getLivestreamBankAccounts(): Promise<LivestreamBankAccounts> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return sanitizeAccounts({});
    // 舊版是自由格式文字（JSON.parse 會丟例外），接到舊資料時直接 fallback
    // 回空白三欄——管理員只需要重新填一次三個帳號，不特別做資料轉換。
    return sanitizeAccounts(JSON.parse(data.image));
  } catch {
    return sanitizeAccounts({});
  }
}

export async function saveLivestreamBankAccounts(
  next: Partial<Record<LivestreamBankAccountKey, unknown>>,
): Promise<LivestreamBankAccounts> {
  const sanitized = sanitizeAccounts(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(sanitized) }, { onConflict: "type" });
  if (error) throw error;
  return sanitized;
}

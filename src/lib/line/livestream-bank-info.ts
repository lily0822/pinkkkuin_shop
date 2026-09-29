import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 店家自己的收款帳號資訊 (社群連線訂單自助匯款流程用) — 沿用
// community-notification-templates.ts 的 schedule_settings 通用 KV 模式，
// 不開新資料表。自由格式文字，不刻意拆銀行/戶名/帳號欄位。
const SETTINGS_TYPE = "community-livestream-bank-info";
const MAX_LENGTH = 2000;

export async function getLivestreamBankInfo(): Promise<string> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return "";
    return String(data.image).slice(0, MAX_LENGTH);
  } catch {
    return "";
  }
}

export async function saveLivestreamBankInfo(text: string): Promise<string> {
  const next = text.trim().slice(0, MAX_LENGTH);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: next }, { onConflict: "type" });
  if (error) throw error;
  return next;
}

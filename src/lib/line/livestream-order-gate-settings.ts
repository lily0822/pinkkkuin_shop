import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 「下單前必須先綁定」開關——schedule_settings KV（跟
// livestream-keywords.ts 同一套模式，不開新表）。讀取失敗或還沒存過時
// 預設「開啟」——比較安全的預設值：賣家要主動關掉才會放寬門禁，不會
// 因為設定讀取意外失敗就悄悄放寬。
const SETTINGS_TYPE = "community-livestream-order-requires-bind";

export async function getOrderRequiresBindSetting(): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return true;
    const parsed = JSON.parse(data.image) as { enabled?: unknown };
    return typeof parsed.enabled === "boolean" ? parsed.enabled : true;
  } catch {
    return true;
  }
}

export async function saveOrderRequiresBindSetting(enabled: boolean): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert(
      { legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify({ enabled: Boolean(enabled) }) },
      { onConflict: "type" },
    );
  if (error) throw error;
}

import "server-only";

import { getLineUserProfile } from "./client";
import { getLineUserBindingLabel, type LiveBindingLabel } from "./live-bindings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type LiveCustomerIdentity = {
  lineName: string;
  binding: LiveBindingLabel | null;
};

const PROFILE_TIMEOUT_MS = 2000;

// LINE Profile API 可能很慢或整個不可用（沒設定 channel token、額度、
// 網路問題……）——用 Promise.race 包一個逾時，逾時或任何失敗都不拋出，
// 直接走 fallback，不能讓這支函式拖慢或弄壞頁面載入。不改動既有共用的
// getLineUserProfile() 本身（client.ts 裡其他呼叫端，例如機器人組顯示
// 名稱，不需要也不應該因為這裡的 2 秒逾時需求被影響），只在這裡包一層。
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function getFallbackDisplayName(lineUserId: string): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data } = await supabase
      .from("community_livestream_orders")
      .select("line_display_name")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const name = (data as { line_display_name: string | null } | null)?.line_display_name;
    return name?.trim() || null;
  } catch {
    return null;
  }
}

// 這個客人專用頁面（/live/*）要顯示的「LINE 名稱 + 綁定標籤」一次查好。
// 名稱優先用即時的 LINE Profile API，取不到（逾時/失敗/沒設定 channel
// token）才退回這個客人最近一筆訂單上存的 line_display_name，再不行
// 顯示「客人」——任何一步失敗都不能讓頁面整個載入失敗。
export async function getLiveCustomerIdentity(lineUserId: string): Promise<LiveCustomerIdentity> {
  const [profile, binding] = await Promise.all([
    withTimeout(getLineUserProfile(lineUserId), PROFILE_TIMEOUT_MS),
    getLineUserBindingLabel(lineUserId),
  ]);

  let lineName = profile?.displayName?.trim() || "";
  if (!lineName) {
    lineName = (await getFallbackDisplayName(lineUserId)) || "";
  }
  if (!lineName) {
    lineName = "客人";
  }

  return { lineName, binding };
}

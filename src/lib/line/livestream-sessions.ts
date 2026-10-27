import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type SupabaseService = ReturnType<typeof createSupabaseServiceClient>;

export type LivestreamSession = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
};

// 「現在有沒有進行中的連線」——下單觸發（功能一）、確認頁送出訂單都要
// 用這支判斷，而且一定是「呼叫當下重新查」，不能信任任何快照（場次可能
// 在客人填單價的這段時間內結束）。同一時間最多一筆（資料庫 exclusion
// constraint 保證），這裡用 limit(1) 純粹是防禦性寫法。
export async function getCurrentSession(supabase: SupabaseService): Promise<LivestreamSession | null> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("community_livestream_sessions")
    .select("id, name, starts_at, ends_at")
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .limit(1)
    .maybeSingle();
  return (data as LivestreamSession | null) || null;
}

// 「當下連線」的定義（第二階段查詢訂單／這次後台篩選的預設值共用）：
// 有進行中的場次就是那一場；沒有的話退而求其次抓「最近一場已經開始的
// 場次」，直到下一場開始才換掉——賣家常在連線後隔天才採買、填價格，
// 客人要能一直看到結果直到下一場真正開始。
export async function getCurrentOrMostRecentSession(supabase: SupabaseService): Promise<LivestreamSession | null> {
  const current = await getCurrentSession(supabase);
  if (current) return current;

  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("community_livestream_sessions")
    .select("id, name, starts_at, ends_at")
    .lte("starts_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LivestreamSession | null) || null;
}

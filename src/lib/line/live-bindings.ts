import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 客人專用頁面（/live/*）顯示的「綁定標籤」資料來源——獨立成一支小函式，
// 日後做綁定功能新增 IG 類型時，只需要改這支函式（跟它讀的資料表），
// 呼叫端（live-customer-identity.ts）跟頁面完全不用改。
export type LiveBindingLabel = { type: "nickname" | "ig"; value: string };

type BindingRow = {
  nickname: string | null;
  review_status: string | null;
};

// 目前 community_line_bindings 還沒有 IG 類型，只有社群暱稱——nickname
// 有值且 review_status='approved' 才算「已綁定」（跟後台社群名單審核
// 頁面、既有的綁定判斷邏輯一致，pending/not_requested 都不算）。
export async function getLineUserBindingLabel(lineUserId: string): Promise<LiveBindingLabel | null> {
  const id = lineUserId.trim();
  if (!id) return null;
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_line_bindings")
      .select("nickname, review_status")
      .eq("line_user_id", id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as BindingRow;
    const nickname = row.nickname?.trim();
    if (nickname && row.review_status === "approved") {
      return { type: "nickname", value: nickname };
    }
    return null;
  } catch {
    return null;
  }
}

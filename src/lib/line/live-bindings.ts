import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 客人專用頁面（/live/*）顯示的「綁定標籤」資料來源——獨立成一支小函式，
// 呼叫端（live-customer-identity.ts）跟頁面完全不用知道資料實際存在
// 哪張表。社群綁定功能上線後，讀取順序是：先查新表
// community_line_identities（社群綁定功能這次新增，支援暱稱／IG 兩種
// 類型），沒有才退回舊表 community_line_bindings（社群記事本既有的
// 暱稱審核機制，review_status='approved' 才算已綁定，type 固定是
// 'nickname'）——新表沒有動過舊表任何資料/語意，純粹是讀取時的
// fallback 順序。
export type LiveBindingLabel = { type: "nickname" | "ig"; value: string };

type IdentityRow = {
  binding_type: string | null;
  binding_value: string | null;
};

type LegacyBindingRow = {
  nickname: string | null;
  review_status: string | null;
};

export async function getLineUserBindingLabel(lineUserId: string): Promise<LiveBindingLabel | null> {
  const id = lineUserId.trim();
  if (!id) return null;

  try {
    const supabase = createSupabaseServiceClient();

    const { data: identity, error: identityError } = await supabase
      .from("community_line_identities")
      .select("binding_type, binding_value")
      .eq("line_user_id", id)
      .maybeSingle();
    if (!identityError && identity) {
      const row = identity as IdentityRow;
      if ((row.binding_type === "nickname" || row.binding_type === "ig") && row.binding_value) {
        return { type: row.binding_type, value: row.binding_value };
      }
    }

    const { data: legacy, error: legacyError } = await supabase
      .from("community_line_bindings")
      .select("nickname, review_status")
      .eq("line_user_id", id)
      .maybeSingle();
    if (legacyError || !legacy) return null;
    const legacyRow = legacy as LegacyBindingRow;
    const nickname = legacyRow.nickname?.trim();
    if (nickname && legacyRow.review_status === "approved") {
      return { type: "nickname", value: nickname };
    }
    return null;
  } catch {
    return null;
  }
}

// 批次版本——後台「社群連線訂單」「依客人統計」「匯款紀錄」這幾個會
// 一次列出一整批客人的畫面用這支，兩次查詢（新表 + 舊表，各一次
// `in (...)`）就能拿到全部人的綁定標籤，不用每筆訂單各自查一次。回傳
// Map，查不到的 line_user_id 直接沒有這個 key（呼叫端用 .get(id) ??
// null 取值）。
export async function getLineUserBindingLabelsBatch(
  lineUserIds: string[],
): Promise<Map<string, LiveBindingLabel>> {
  const ids = [...new Set(lineUserIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, LiveBindingLabel>();
  if (!ids.length) return result;

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: identities }, { data: legacyRows }] = await Promise.all([
      supabase
        .from("community_line_identities")
        .select("line_user_id, binding_type, binding_value")
        .in("line_user_id", ids),
      supabase
        .from("community_line_bindings")
        .select("line_user_id, nickname, review_status")
        .in("line_user_id", ids)
        .eq("review_status", "approved"),
    ]);

    // 舊表先填——新表後填會覆蓋掉同一個 line_user_id 的舊表結果，維持
    // 跟單筆查詢版本一樣「新表優先」的語意。
    ((legacyRows as { line_user_id: string; nickname: string | null; review_status: string | null }[] | null) || []).forEach(
      (row) => {
        const nickname = row.nickname?.trim();
        if (nickname) result.set(row.line_user_id, { type: "nickname", value: nickname });
      },
    );
    ((identities as { line_user_id: string; binding_type: string; binding_value: string }[] | null) || []).forEach((row) => {
      if (row.binding_type === "nickname" || row.binding_type === "ig") {
        result.set(row.line_user_id, { type: row.binding_type, value: row.binding_value });
      }
    });

    return result;
  } catch {
    return result;
  }
}

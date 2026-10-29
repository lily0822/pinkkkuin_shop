import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 客人專用頁面（/live/*）顯示的「綁定標籤」資料來源——獨立成一支小函式，
// 呼叫端（live-customer-identity.ts）跟頁面完全不用知道資料實際存在
// 哪張表。統一綁定（2026-10-29）之後，community_line_identities 是唯一
// 的資料來源——舊表 community_line_bindings 已核准的資料都搬移過去了
// （見 202610290001 migration），這裡不再有 fallback 讀舊表。顯示用的
// 這支函式不過濾 needs_review——客人自己應該永遠看得到自己目前綁定的
// 是什麼，needs_review 只影響「用暱稱找人」這個方向（見下面
// findLineUserIdByNickname），不影響「這個人綁了什麼」這個方向。
export type LiveBindingLabel = { type: "nickname" | "ig"; value: string };

type IdentityRow = {
  binding_type: string | null;
  binding_value: string | null;
};

export async function getLineUserBindingLabel(lineUserId: string): Promise<LiveBindingLabel | null> {
  const id = lineUserId.trim();
  if (!id) return null;

  try {
    const supabase = createSupabaseServiceClient();
    const { data: identity, error } = await supabase
      .from("community_line_identities")
      .select("binding_type, binding_value")
      .eq("line_user_id", id)
      .maybeSingle();
    if (error || !identity) return null;
    const row = identity as IdentityRow;
    if ((row.binding_type === "nickname" || row.binding_type === "ig") && row.binding_value) {
      return { type: row.binding_type, value: row.binding_value };
    }
    return null;
  } catch {
    return null;
  }
}

// 批次版本——後台「社群連線訂單」「依客人統計」「匯款紀錄」這幾個會
// 一次列出一整批客人的畫面用這支，一次查詢就能拿到全部人的綁定標籤，
// 不用每筆訂單各自查一次。回傳 Map，查不到的 line_user_id 直接沒有這個
// key（呼叫端用 .get(id) ?? null 取值）。
export async function getLineUserBindingLabelsBatch(
  lineUserIds: string[],
): Promise<Map<string, LiveBindingLabel>> {
  const ids = [...new Set(lineUserIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, LiveBindingLabel>();
  if (!ids.length) return result;

  try {
    const supabase = createSupabaseServiceClient();
    const { data: identities } = await supabase
      .from("community_line_identities")
      .select("line_user_id, binding_type, binding_value")
      .in("line_user_id", ids);

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

// ---------------------------------------------------------------------------
// 反向查找：用「暱稱」找 LINE 使用者——給記事本通知（community-
// notifications.ts）、後台社群訂單/出貨明細（顯示 LINE 名稱）這幾個
// 「用暱稱找人」的地方共用。只採用 needs_review=false 的綁定——客人自己
// 綁定、撞到記事本既有客人名字時會先標記待核准，在核准之前不能被拿去
// 找人，否則客人填了別人的名字就能收到對方的通知。正規化規則（trim+
// 小寫+去掉開頭 @）跟資料庫端 submit_community_line_identity RPC 判斷
// needs_review 用的是同一套，兩邊比對結果才會一致——實際比對邏輯在
// 資料庫函式 find_line_user_id_by_nickname/find_line_user_ids_by_nicknames
// 裡做（見 202610290001 migration），這裡只是包一層給 TS 呼叫端用。
// ---------------------------------------------------------------------------

export async function findLineUserIdByNickname(value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("find_line_user_id_by_nickname", { p_value: trimmed });
    if (error || typeof data !== "string" || !data) return "";
    return data;
  } catch {
    return "";
  }
}

// 批次版本——給一次要處理一整批不同客人（不同暱稱）的列表頁用。回傳
// Map，key 是呼叫端傳入的原始字串 trim+小寫後的值（呼叫端對自己的
// nickname 變數做同樣的 .trim().toLowerCase() 就能查得到，不用再處理
// 開頭 @ 之類的正規化細節——那些在資料庫函式裡比對時已經做過）。
export async function findLineUserIdsByNicknames(values: string[]): Promise<Map<string, string>> {
  const uniqueValues = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const result = new Map<string, string>();
  if (!uniqueValues.length) return result;

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("find_line_user_ids_by_nicknames", { p_values: uniqueValues });
    if (error || !data) return result;
    for (const row of data as { input_value: string; line_user_id: string }[]) {
      result.set(row.input_value.trim().toLowerCase(), row.line_user_id);
    }
    return result;
  } catch {
    return result;
  }
}

// 給「後台顯示」用的版本——跟上面兩個不同：
// (a) 不過濾 needs_review，連「還沒核准」的綁定也要顯示出來，呼叫端
//     （社群訂單/出貨明細列表）自己決定要不要加「（待核准）」之類的
//     提示文字；
// (b) 不像 findLineUserId(s)ByNickname 遇到歧義（同一個正規化後的名字
//     同時對應到不只一個 line_user_id）就直接當「找不到」安靜略過——
//     顯示畫面需要讓賣家自己看到、自己判斷，所以底層 SQL 函式
//     find_line_identities_by_nicknames 仍然回傳全部符合的列，歧義判斷
//     在這一層（TS）做：同一個 input_value 底下如果有超過一個相異的
//     line_user_id，整組標成 ambiguous:true，不要任選其中一筆顯示。
export type NicknameIdentityDisplay =
  | { ambiguous: true }
  | { ambiguous: false; lineDisplayName: string; needsReview: boolean };

export async function findLineIdentitiesByNicknames(values: string[]): Promise<Map<string, NicknameIdentityDisplay>> {
  const uniqueValues = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const result = new Map<string, NicknameIdentityDisplay>();
  if (!uniqueValues.length) return result;

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("find_line_identities_by_nicknames", { p_values: uniqueValues });
    if (error || !data) return result;

    const grouped = new Map<string, { line_user_id: string; line_display_name: string | null; needs_review: boolean }[]>();
    for (const row of data as { input_value: string; line_user_id: string; line_display_name: string | null; needs_review: boolean }[]) {
      const key = row.input_value.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    for (const [key, rows] of grouped) {
      const distinctUsers = new Set(rows.map((r) => r.line_user_id));
      if (distinctUsers.size > 1) {
        result.set(key, { ambiguous: true });
        continue;
      }
      const row = rows[0];
      result.set(key, {
        ambiguous: false,
        lineDisplayName: row.line_display_name?.trim() || "LINE 使用者",
        needsReview: Boolean(row.needs_review),
      });
    }

    return result;
  } catch {
    return result;
  }
}

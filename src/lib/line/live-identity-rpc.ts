import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { LiveBindingType } from "./live-identity-validation";

// 包一層給 /api/live/bind（客人端，actor='customer'）跟後台相關路由
// （actor='admin'）共用，呼叫端不用各自處理 RPC 回傳的錯誤碼字串比對。
export type LiveIdentityRecord = {
  id: string;
  lineUserId: string;
  bindingType: LiveBindingType;
  bindingValue: string;
};

export type SubmitLiveIdentityResult =
  | { ok: true; identity: LiveIdentityRecord }
  | { ok: false; error: "conflict" | "unchanged" | "unknown" };

type RpcIdentityRow = {
  id: string;
  line_user_id: string;
  binding_type: string;
  binding_value: string;
};

// 這支 RPC 回傳 jsonb（不是 RAISE EXCEPTION）來表達 'conflict'/'unchanged'
// 這兩種「預期內的業務結果」——原因是：如果用 RAISE EXCEPTION，即使
// exception handler 裡有順手補一筆 blocked 紀錄，只要函式呼叫這個單一
// SQL 陳述式最終還是以錯誤收場，PostgREST 幫這次呼叫開的交易就會整個
// 回滾，連 handler 裡的 insert 也一起被撤銷（本機測試才抓到，第一版
// 修正以為「exception handler 是獨立 subtransaction」就能倖免，實際上
// 不行，因為外層交易本身失敗了）。改成正常 return 一個 jsonb
// 物件後，函式呼叫永遠成功結束、交易正常 commit，blocked 紀錄才真的
// 留得下來。
type RpcResult =
  | { ok: true; identity: RpcIdentityRow }
  | { ok: false; error: string };

export async function submitLiveIdentity(params: {
  lineUserId: string;
  lineDisplayName: string | null;
  bindingType: LiveBindingType;
  bindingValue: string;
  actor: "customer" | "admin";
}): Promise<SubmitLiveIdentityResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("submit_community_line_identity", {
    p_line_user_id: params.lineUserId,
    p_line_display_name: params.lineDisplayName,
    p_binding_type: params.bindingType,
    p_binding_value: params.bindingValue,
    p_actor: params.actor,
  });

  // error 這裡只會是真正意外的情況（invalid_type/invalid_value/
  // invalid_actor 這些呼叫端參數寫錯的防呆、或資料庫層級的其他錯誤）——
  // 'conflict'/'unchanged' 這兩種業務結果已經改成正常回傳值，不會走
  // 到這裡。
  if (error || !data) {
    return { ok: false, error: "unknown" };
  }

  const result = data as RpcResult;
  if (!result.ok) {
    if (result.error === "conflict") return { ok: false, error: "conflict" };
    if (result.error === "unchanged") return { ok: false, error: "unchanged" };
    return { ok: false, error: "unknown" };
  }

  const row = result.identity;
  return {
    ok: true,
    identity: {
      id: row.id,
      lineUserId: row.line_user_id,
      bindingType: row.binding_type as LiveBindingType,
      bindingValue: row.binding_value,
    },
  };
}

export type UnbindLiveIdentityResult = { ok: true } | { ok: false; error: "not_bound" | "unknown" };

export async function unbindLiveIdentity(lineUserId: string): Promise<UnbindLiveIdentityResult> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc("unbind_community_line_identity", { p_line_user_id: lineUserId });
  if (error) {
    return { ok: false, error: error.message?.includes("not_bound") ? "not_bound" : "unknown" };
  }
  return { ok: true };
}

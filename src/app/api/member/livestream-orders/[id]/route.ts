import { NextRequest, NextResponse } from "next/server";
import { isMemberDisabled } from "@/lib/member/status";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return authJsonError("請先登入會員。", 401);
  if (await isMemberDisabled(supabase, userData.user.id)) return authJsonError("會員帳號目前已停用。", 403);

  // line_user_id comes ONLY from this lookup, keyed on the session's own user_id.
  const { data: binding } = await supabase
    .from("member_line_accounts")
    .select("line_user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!binding?.line_user_id) return authJsonError("尚未綁定 LINE 帳號。", 403);

  const { id } = await params;
  const orderId = id.trim();
  if (!orderId) return authJsonError("找不到這筆訂單，可能已經被取消過了。", 404);

  const service = createSupabaseServiceClient();

  // Ownership is enforced by scoping this lookup to the member's own bound
  // line_user_id. 連線代購下單改版 第二階段：鎖定規則改成跟 /live/orders
  // 同一套（purchased_quantity/remittance_id 皆為 null 才能取消），不再
  // 用舊的 purchase_status/payment_status 二元判斷；取消改成軟刪除
  // （order_status='cancelled'，跟 /api/live/orders/update 一致），不再
  // 硬刪除資料列。
  const { data: row } = await service
    .from("community_livestream_orders")
    .select("purchased_quantity, remittance_id")
    .eq("id", orderId)
    .eq("line_user_id", binding.line_user_id)
    .eq("order_status", "submitted")
    .maybeSingle();

  if (!row) return authJsonError("找不到這筆訂單，可能已經被取消過了。", 404);
  if (row.purchased_quantity !== null) return authJsonError("這項商品已經採買，無法取消。", 409);
  if (row.remittance_id !== null) return authJsonError("這項商品已在匯款流程中，無法取消。", 409);

  const { data: updated } = await service
    .from("community_livestream_orders")
    .update({ order_status: "cancelled" })
    .eq("id", orderId)
    .eq("line_user_id", binding.line_user_id)
    .eq("order_status", "submitted")
    .is("purchased_quantity", null)
    .is("remittance_id", null)
    .select("id");
  if (!updated || !updated.length) return authJsonError("取消失敗，請稍後再試一次。");

  return response;
}

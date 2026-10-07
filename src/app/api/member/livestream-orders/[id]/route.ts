import { NextRequest, NextResponse } from "next/server";
import { deleteLivestreamOrder } from "@/lib/line/livestream-orders";
import { getLivestreamReplyTemplates } from "@/lib/line/livestream-reply-templates";
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
  // line_user_id — the row is only found (and therefore only deletable) if it
  // belongs to this member, mirroring handleCancelOrder's lookup-then-delete pattern.
  const { data: row } = await service
    .from("community_livestream_orders")
    .select("purchase_status, payment_status")
    .eq("id", orderId)
    .eq("line_user_id", binding.line_user_id)
    .maybeSingle();

  if (!row) return authJsonError("找不到這筆訂單，可能已經被取消過了。", 404);

  const templates = await getLivestreamReplyTemplates();
  if (row.purchase_status !== "not_bought") return authJsonError(templates.cancel_blocked_bought, 409);
  if (row.payment_status !== "unpaid") return authJsonError(templates.cancel_blocked_paying, 409);

  const ok = await deleteLivestreamOrder(service, orderId);
  if (!ok) return authJsonError("取消失敗，請稍後再試一次。");

  return response;
}

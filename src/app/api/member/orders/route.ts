import { NextRequest, NextResponse } from "next/server";
import { appendSupabaseCookies, authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function mapOrder(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    orderNo: String(row.order_no || ""),
    productType: String(row.order_type || ""),
    createdAt: String(row.created_at || ""),
    total: Number(row.total || 0),
    status: String(row.status || ""),
    paymentStatus: String(row.payment_status || ""),
    shippingStatus: String(row.shipping_status || ""),
  };
}

export async function GET(request: NextRequest) {
  const cookieResponse = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, cookieResponse);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) {
    return appendSupabaseCookies(authJsonError("請先登入會員。", 401), cookieResponse);
  }

  if (await isMemberDisabled(supabase, user.id)) {
    return appendSupabaseCookies(authJsonError("會員帳號目前已停用。", 403), cookieResponse);
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id,order_no,order_type,created_at,total,status,payment_status,shipping_status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return appendSupabaseCookies(authJsonError("訂單資料讀取失敗，請稍後再試。", 500), cookieResponse);
  }

  return appendSupabaseCookies(
    NextResponse.json({ ok: true, orders: (data || []).map(mapOrder) }),
    cookieResponse,
  );
}

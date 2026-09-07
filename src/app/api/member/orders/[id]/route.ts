import { NextRequest, NextResponse } from "next/server";
import { appendSupabaseCookies, authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function mapOrderDetail(row: Record<string, unknown>) {
  const items = Array.isArray(row.order_items) ? row.order_items : [];
  return {
    id: String(row.id || ""),
    orderNo: String(row.order_no || ""),
    productType: String(row.order_type || ""),
    createdAt: String(row.created_at || ""),
    subtotal: Number(row.subtotal || 0),
    shippingFee: Number(row.shipping_fee || 0),
    discountAmount: Number(row.discount_amount || 0),
    total: Number(row.total || 0),
    status: String(row.status || ""),
    paymentStatus: String(row.payment_status || ""),
    shippingStatus: String(row.shipping_status || ""),
    items: items.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id || ""),
        productName: String(record.product_name || "未命名商品"),
        variantSpec: String(record.variant_spec || ""),
        productType: String(record.product_type || row.order_type || ""),
        unitPrice: Number(record.unit_price || 0),
        quantity: Number(record.quantity || 0),
        subtotal: Number(record.subtotal || 0),
      };
    }),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;
  const orderId = String(id || "").trim();
  if (!orderId) {
    return appendSupabaseCookies(authJsonError("找不到訂單。", 404), cookieResponse);
  }

  let query = supabase
    .from("orders")
    .select(`
      id,
      order_no,
      order_type,
      created_at,
      subtotal,
      shipping_fee,
      discount_amount,
      total,
      status,
      payment_status,
      shipping_status,
      order_items (
        id,
        product_name,
        variant_spec,
        product_type,
        unit_price,
        quantity,
        subtotal
      )
    `)
    .eq("user_id", user.id);

  query = isUuid(orderId) ? query.eq("id", orderId) : query.eq("order_no", orderId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    return appendSupabaseCookies(authJsonError("訂單資料讀取失敗，請稍後再試。", 500), cookieResponse);
  }
  if (!data) {
    return appendSupabaseCookies(authJsonError("找不到訂單。", 404), cookieResponse);
  }

  return appendSupabaseCookies(
    NextResponse.json({ ok: true, order: mapOrderDetail(data) }),
    cookieResponse,
  );
}

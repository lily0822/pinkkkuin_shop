import { NextRequest, NextResponse } from "next/server";
import { PHOTO_BUCKET } from "@/lib/line/livestream-orders";
import { isMemberDisabled } from "@/lib/member/status";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 10 * 60;

export async function GET(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return authJsonError("請先登入會員。", 401);
  if (await isMemberDisabled(supabase, userData.user.id)) return authJsonError("會員帳號目前已停用。", 403);

  // line_user_id comes ONLY from this lookup, keyed on the session's own user_id.
  // Never trust a client-supplied line_user_id or user_id here.
  const { data: binding } = await supabase
    .from("member_line_accounts")
    .select("line_user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!binding?.line_user_id) {
    return NextResponse.json({ ok: true, linked: false, orders: [] });
  }

  const service = createSupabaseServiceClient();
  const { data: rows, error } = await service
    .from("community_livestream_orders")
    .select("id, product_name, quantity, unit_price, total_price, purchase_status, payment_status, photo_storage_path, created_at")
    .eq("line_user_id", binding.line_user_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return authJsonError("連線下單紀錄讀取失敗，請稍後再試。");

  const orders = await Promise.all(
    (rows || []).map(async (row) => ({
      id: row.id,
      productName: row.product_name || "",
      quantity: row.quantity,
      unitPrice: row.unit_price === null ? null : Number(row.unit_price),
      totalPrice: row.total_price === null ? null : Number(row.total_price),
      purchaseStatus: row.purchase_status,
      paymentStatus: row.payment_status,
      photoUrl: row.photo_storage_path ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, SIGNED_URL_TTL_SECONDS) : null,
      createdAt: row.created_at,
    })),
  );

  return NextResponse.json({ ok: true, linked: true, orders });
}

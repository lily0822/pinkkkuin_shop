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
  // 連線代購下單改版：只顯示真的送出過的訂單——order_status 預設排除
  // staged（客人還沒送出的暫存照片）跟 cancelled（第二階段起客人可以
  // 在 /live/orders 自助取消，取消後是軟刪除，這裡不該再顯示）。
  const { data: rows, error } = await service
    .from("community_livestream_orders")
    .select(
      "id, product_name, quantity, unit_price, customer_unit_price, purchased_quantity, purchase_status, payment_status, photo_storage_path, created_at",
    )
    .eq("line_user_id", binding.line_user_id)
    .eq("order_status", "submitted")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return authJsonError("連線下單紀錄讀取失敗，請稍後再試。");

  const orders = await Promise.all(
    (rows || []).map(async (row) => {
      // 有效單價優先用客人自己填的 customer_unit_price，退回舊欄位只是
      // 為了顯示第一階段以前的舊資料；總價改用「買到幾個（還沒採買就用
      // 訂購數量）× 有效單價」——跟後台「社群連線訂單」GET 路由同一套算法。
      const effectiveUnitPrice =
        row.customer_unit_price !== null && row.customer_unit_price !== undefined
          ? Number(row.customer_unit_price)
          : row.unit_price !== null && row.unit_price !== undefined
            ? Number(row.unit_price)
            : null;
      const effectiveQuantity = row.purchased_quantity === null || row.purchased_quantity === undefined ? row.quantity : Number(row.purchased_quantity);
      return {
        id: row.id,
        productName: row.product_name || "",
        quantity: row.quantity,
        unitPrice: effectiveUnitPrice,
        totalPrice: effectiveUnitPrice === null ? null : effectiveUnitPrice * effectiveQuantity,
        purchaseStatus: row.purchase_status,
        paymentStatus: row.payment_status,
        photoUrl: row.photo_storage_path ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, SIGNED_URL_TTL_SECONDS) : null,
        createdAt: row.created_at,
      };
    }),
  );

  return NextResponse.json({ ok: true, linked: true, orders });
}

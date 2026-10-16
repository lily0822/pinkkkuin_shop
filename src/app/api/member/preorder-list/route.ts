import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

// 加入預購清單：寫入 preorder_list_items 的同商品/同規格累加語意是靠
// DB 端的 add_to_preorder_list() RPC 做的（202610180001）——那張表的
// 唯一性是運算式 index，PostgREST 的 upsert on_conflict 沒辦法對應，
// 所以不在這裡用 .upsert()，直接呼叫 RPC。RPC 本身也會重新驗證商品/
// 規格是不是真的存在、是不是預購中的上架商品，不信任這裡傳進來的任何
// 商品資料，只信任 auth.uid()。
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  let body: { productId?: unknown; variantId?: unknown; quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const productId = String(body.productId || "").trim();
  if (!productId) return authJsonError("請提供正確的商品。");
  const variantId = body.variantId ? String(body.variantId).trim() : null;
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));

  const { data, error } = await supabase.rpc("add_to_preorder_list", {
    p_product_id: productId,
    p_variant_id: variantId,
    p_quantity: quantity,
  });

  if (error) return authJsonError(error.message || "加入預購清單失敗，請稍後再試。", 400);
  return NextResponse.json({ ok: true, quantity: (data as { quantity?: number } | null)?.quantity ?? quantity });
}

import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

// 這兩個動作只動 preorder_list_items 這張表本身（不用 join 商品/規格
// 資料），authenticated 角色對這張表本來就有 grant + RLS（user_id =
// auth.uid()），直接用 route client 就夠，不需要 service client。
async function getUserClient(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response: unauthorized(), supabase: null, userId: "" };
  if (await isMemberDisabled(supabase, data.user.id)) {
    return { response: authJsonError("會員帳號目前已停用。", 403), supabase: null, userId: "" };
  }
  return { response, supabase, userId: data.user.id };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, supabase, userId } = await getUserClient(request);
  if (!supabase) return response;
  const { id } = await params;
  const itemId = id.trim();
  if (!itemId) return authJsonError("預購清單項目不存在。", 404);

  let body: { quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const quantity = Math.floor(Number(body.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) return authJsonError("數量至少為 1。");

  const { data, error } = await supabase
    .from("preorder_list_items")
    .update({ quantity })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("id,quantity")
    .maybeSingle();

  if (error) return authJsonError("更新數量失敗，請稍後再試。", 500);
  if (!data) return authJsonError("預購清單項目不存在。", 404);
  return NextResponse.json({ ok: true, quantity: data.quantity });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, supabase, userId } = await getUserClient(request);
  if (!supabase) return response;
  const { id } = await params;
  const itemId = id.trim();
  if (!itemId) return authJsonError("預購清單項目不存在。", 404);

  const { error } = await supabase.from("preorder_list_items").delete().eq("id", itemId).eq("user_id", userId);
  if (error) return authJsonError("移除失敗，請稍後再試。", 500);
  return NextResponse.json({ ok: true });
}

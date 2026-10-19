import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

// 送出預購清單：第一期已經做好的 create_preorder_registration()
// RPC——不吃任何參數，只從呼叫者自己的 auth.uid() 重新查整份清單、
// 重新驗證商品/規格/名額，這裡不需要（也不應該）先在前端組好清單內容
// 傳過去，直接呼叫就好。失敗時 RPC 會用 raise exception 回中文訊息
// （清單是空的/商品或規格目前無法登記/名額不足），原樣回給前端顯示。
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  const { data, error } = await supabase.rpc("create_preorder_registration");
  if (error) return authJsonError(error.message || "預購登記失敗，請稍後再試。", 400);

  return NextResponse.json({ ok: true, order: data });
}

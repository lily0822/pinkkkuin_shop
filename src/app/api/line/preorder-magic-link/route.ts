import { NextRequest, NextResponse } from "next/server";
import { verifyPreorderMagicLink } from "@/lib/line/preorder-magic-link";
import { isMemberDisabled } from "@/lib/member/status";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

// 這支路由第一期先獨立做好、能單獨測試（手動組一個 token 丟進來就能
// 驗證整條路有沒有通）；真正從 LINE 回覆訊息裡把這個連結送出去，是
// 第二期 webhook 的事，這裡不等它。
//
// 跟 src/app/api/auth/line/callback/route.ts（既有 LINE OAuth 登入
// callback）用同一套「generateLink({type:'magiclink'}) + verifyOtp」
// session-minting 做法，差別只在「怎麼確認這個人是誰」：OAuth callback
// 是從真正的 LINE OAuth code 換來的 profile；這裡是從簽章過、還沒過期
// 的 token 裡解出 lineUserId。兩者都一樣：user_id 永遠重新查
// member_line_accounts 現在的真實綁定狀態，不會相信 token 以外任何
// 輸入，也不會把 user_id 直接放進 token（這樣綁定被解除後，舊連結會
// 自動失效，不需要額外維護黑名單/一次性 token 表——這點已經跟使用者
// 確認過不需要）。
function loginRedirect(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/login?preorder=${encodeURIComponent(status)}`, request.url));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const payload = verifyPreorderMagicLink(token);
  if (!payload) {
    return loginRedirect(request, "expired");
  }

  const service = createSupabaseServiceClient();

  const { data: binding } = await service
    .from("member_line_accounts")
    .select("user_id")
    .eq("line_user_id", payload.lineUserId)
    .maybeSingle();

  if (!binding?.user_id) {
    return loginRedirect(request, "not-bound");
  }

  if (await isMemberDisabled(service, binding.user_id)) {
    return loginRedirect(request, "disabled");
  }

  const { data: userData, error: userError } = await service.auth.admin.getUserById(binding.user_id);
  const email = userData?.user?.email;
  if (userError || !email) {
    return loginRedirect(request, "failed");
  }

  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link?.properties?.hashed_token) {
    return loginRedirect(request, "failed");
  }

  const response = NextResponse.redirect(new URL(payload.returnTo, request.url));
  const supabase = createSupabaseRouteClient(request, response);
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) {
    return loginRedirect(request, "failed");
  }

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/auth/password";
import { isMemberDisabled } from "@/lib/member/status";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { password?: unknown; confirmPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const passwordError = validatePassword(password, confirmPassword);
  if (passwordError) return authJsonError(passwordError);

  const response = NextResponse.json({ ok: true, message: "密碼已更新。" });
  const supabase = createSupabaseRouteClient(request, response);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return authJsonError("請先登入會員。", 401);
  if (await isMemberDisabled(supabase, userData.user.id)) return authJsonError("會員帳號目前已停用。", 403);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return authJsonError("新密碼與目前密碼相同。");
    if (error.code === "weak_password") return authJsonError("密碼強度不足，請換一組更複雜的密碼。");
    return authJsonError("密碼更新失敗，請稍後再試。");
  }

  return response;
}

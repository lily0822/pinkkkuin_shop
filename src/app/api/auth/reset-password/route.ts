import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/auth/password";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";

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

  const response = NextResponse.json({ ok: true, message: "密碼已更新，請重新登入。" });
  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return authJsonError("密碼重設連結已失效，請重新申請。", 401);
  await supabase.auth.signOut();
  return response;
}

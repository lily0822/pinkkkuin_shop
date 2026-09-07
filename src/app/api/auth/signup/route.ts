import { NextRequest, NextResponse } from "next/server";
import { isMemberSignupEnabled } from "@/lib/member/signup";
import { getSiteOrigin } from "@/lib/supabase/config";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePassword(value: unknown) {
  return typeof value === "string" ? value : "";
}

function validatePassword(password: string, confirmPassword: string) {
  if (password.length < 8) return "密碼至少需要 8 個字元。";
  if (password.trim().length !== password.length || !password.trim()) return "密碼不可空白或包含前後空格。";
  if (password !== confirmPassword) return "兩次輸入的密碼不一致。";
  return "";
}

export async function POST(request: NextRequest) {
  if (!isMemberSignupEnabled()) {
    return authJsonError("會員註冊暫未開放。", 403);
  }

  let body: { email?: unknown; password?: unknown; confirmPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const confirmPassword = normalizePassword(body.confirmPassword);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authJsonError("請輸入有效的 Email。");
  const passwordError = validatePassword(password, confirmPassword);
  if (passwordError) return authJsonError(passwordError);

  const response = NextResponse.json({
    ok: true,
    message: "註冊申請已送出，請到信箱確認驗證信。",
  });
  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteOrigin(request.nextUrl.origin)}/auth/callback?next=/member`,
    },
  });

  if (error) return authJsonError("註冊申請無法完成，請稍後再試。");
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/supabase/config";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const email = normalizeEmail(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authJsonError("請輸入有效的 Email。");

  const response = NextResponse.json({
    ok: true,
    message: "如果此 Email 已註冊，我們會寄出重設密碼信。",
  });
  const supabase = createSupabaseRouteClient(request, response);
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteOrigin(request.nextUrl.origin)}/auth/callback?next=/reset-password`,
  });

  return response;
}

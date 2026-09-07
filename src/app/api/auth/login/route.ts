import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { safeRelativePath } from "@/lib/supabase/server";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return authJsonError("Email 或密碼不正確。", 401);

  const response = NextResponse.json({ ok: true, next: safeRelativePath(typeof body.next === "string" ? body.next : null) });
  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return authJsonError("Email 或密碼不正確。", 401);

  return response;
}

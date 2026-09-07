import { NextRequest, NextResponse } from "next/server";
import { appendSupabaseCookies, authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function mapBinding(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    linkedAt: String(row.linked_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

async function getMemberLineContext(request: NextRequest) {
  const cookieResponse = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, cookieResponse);
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) return { cookieResponse, supabase: null, userId: "", disabled: false };
  if (await isMemberDisabled(supabase, user.id)) {
    return { cookieResponse, supabase: null, userId: "", disabled: true };
  }
  return { cookieResponse, supabase, userId: user.id };
}

export async function GET(request: NextRequest) {
  const { cookieResponse, supabase, userId, disabled } = await getMemberLineContext(request);
  if (disabled) return appendSupabaseCookies(authJsonError("會員帳號目前已停用。", 403), cookieResponse);
  if (!supabase) return appendSupabaseCookies(authJsonError("請先登入會員。", 401), cookieResponse);

  const { data, error } = await supabase
    .from("member_line_accounts")
    .select("linked_at,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return appendSupabaseCookies(authJsonError("LINE 綁定資料讀取失敗，請稍後再試。", 500), cookieResponse);
  }

  return appendSupabaseCookies(
    NextResponse.json({ ok: true, binding: mapBinding(data) }),
    cookieResponse,
  );
}

export async function DELETE(request: NextRequest) {
  const { cookieResponse, supabase, userId, disabled } = await getMemberLineContext(request);
  if (disabled) return appendSupabaseCookies(authJsonError("會員帳號目前已停用。", 403), cookieResponse);
  if (!supabase) return appendSupabaseCookies(authJsonError("請先登入會員。", 401), cookieResponse);

  const { error } = await supabase
    .from("member_line_accounts")
    .delete()
    .eq("user_id", userId);

  if (error) {
    return appendSupabaseCookies(authJsonError("LINE 解除綁定失敗，請稍後再試。", 500), cookieResponse);
  }

  return appendSupabaseCookies(NextResponse.json({ ok: true }), cookieResponse);
}

import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";
import { normalizeProfileInput, validateProfileInput } from "@/lib/member/validation";
import { isMemberDisabled } from "@/lib/member/status";

export const dynamic = "force-dynamic";

function unauthorized() {
  return authJsonError("請先登入會員。", 401);
}

export async function GET(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  const { data, error } = await supabase
    .from("member_profiles")
    .select("user_id,display_name,phone,status,created_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return authJsonError("會員資料讀取失敗，請稍後再試。", 500);
  return NextResponse.json({
    ok: true,
    email: user.email || "",
    emailVerified: Boolean(user.email_confirmed_at),
    profile: data
      ? {
          displayName: data.display_name || "",
          phone: data.phone || "",
          status: data.status || "active",
        }
      : null,
  });
}

export async function PUT(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return unauthorized();
  if (await isMemberDisabled(supabase, user.id)) return authJsonError("會員帳號目前已停用。", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return authJsonError("請確認輸入內容後再試。");
  }

  const input = normalizeProfileInput(body);
  const validationError = validateProfileInput(input);
  if (validationError) return authJsonError(validationError);

  const { data, error } = await supabase
    .from("member_profiles")
    .upsert({
      user_id: user.id,
      display_name: input.displayName || null,
      phone: input.phone || null,
      status: "active",
    })
    .select("display_name,phone,status")
    .single();

  if (error) return authJsonError("會員資料儲存失敗，請稍後再試。", 500);
  return NextResponse.json({
    ok: true,
    profile: {
      displayName: data.display_name || "",
      phone: data.phone || "",
      status: data.status || "active",
    },
  });
}

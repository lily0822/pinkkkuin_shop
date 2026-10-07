import { NextRequest, NextResponse } from "next/server";
import { authJsonError, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, response);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return authJsonError("請先登入會員。", 401);

  const { data: identitiesData, error: identitiesError } = await supabase.auth.getUserIdentities();
  if (identitiesError || !identitiesData) return authJsonError("Google 綁定狀態讀取失敗，請稍後再試。");

  const googleIdentity = identitiesData.identities.find((identity) => identity.provider === "google");
  if (!googleIdentity) return authJsonError("目前沒有綁定 Google 帳號。");

  const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
  if (error) {
    if (error.code === "single_identity_not_deletable") return authJsonError("這是唯一的登入方式，無法解除綁定。");
    return authJsonError("解除綁定失敗，請稍後再試。");
  }

  return response;
}

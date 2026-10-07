import { NextRequest, NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/supabase/config";
import { appendSupabaseCookies, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const carrier = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, carrier);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return appendSupabaseCookies(NextResponse.redirect(new URL("/login?next=/member/account", request.url)), carrier);
  }

  const { data, error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: `${getSiteOrigin(request.nextUrl.origin)}/auth/callback?next=${encodeURIComponent("/member/account")}`,
    },
  });

  if (error || !data.url) {
    const status = error?.code === "manual_linking_disabled" ? "link-disabled" : "link-failed";
    return appendSupabaseCookies(NextResponse.redirect(new URL(`/member/account?google=${status}`, request.url)), carrier);
  }

  return appendSupabaseCookies(NextResponse.redirect(data.url), carrier);
}

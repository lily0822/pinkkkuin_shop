import { NextRequest, NextResponse } from "next/server";
import { getSiteFeatureFlag } from "@/lib/site-feature-flags";
import { getSiteOrigin } from "@/lib/supabase/config";
import { safeRelativePath } from "@/lib/supabase/server";
import { appendSupabaseCookies, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const loginFlag = await getSiteFeatureFlag("login");
  if (!loginFlag.enabled) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const next = safeRelativePath(request.nextUrl.searchParams.get("next"), "/member/orders");
  const carrier = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, carrier);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteOrigin(request.nextUrl.origin)}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return appendSupabaseCookies(NextResponse.redirect(new URL("/login?oauth=failed", request.url)), carrier);
  }

  return appendSupabaseCookies(NextResponse.redirect(data.url), carrier);
}

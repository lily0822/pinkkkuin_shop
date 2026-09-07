import { NextRequest, NextResponse } from "next/server";
import { createLineLoginState, buildLineAuthorizeUrl, isLineLoginConfigured, LINE_STATE_COOKIE, STATE_COOKIE_MAX_AGE } from "@/lib/line/login";
import { isMemberDisabled } from "@/lib/member/status";
import { appendSupabaseCookies, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieResponse = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, cookieResponse);
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) {
    return appendSupabaseCookies(
      NextResponse.redirect(new URL("/login?next=/member", request.url)),
      cookieResponse,
    );
  }
  if (await isMemberDisabled(supabase, user.id)) {
    return appendSupabaseCookies(
      NextResponse.redirect(new URL("/member?line=disabled", request.url)),
      cookieResponse,
    );
  }

  if (!isLineLoginConfigured(request.nextUrl.origin)) {
    return appendSupabaseCookies(
      NextResponse.redirect(new URL("/member?line=not-configured", request.url)),
      cookieResponse,
    );
  }

  const state = createLineLoginState(user.id, "/member");
  const response = NextResponse.redirect(buildLineAuthorizeUrl(request.nextUrl.origin, state));
  response.cookies.set(LINE_STATE_COOKIE, state.token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });

  return appendSupabaseCookies(response, cookieResponse);
}

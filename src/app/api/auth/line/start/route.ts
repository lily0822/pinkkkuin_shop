import { NextRequest, NextResponse } from "next/server";
import { buildLineAuthorizeUrl, createLineLoginState, isLineLoginConfigured, LINE_SIGNIN_STATE_COOKIE, STATE_COOKIE_MAX_AGE } from "@/lib/line/login";
import { safeRelativePath } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLineLoginConfigured(request.nextUrl.origin, "signin")) {
    return NextResponse.redirect(new URL("/login?line=not-configured", request.url));
  }

  const next = safeRelativePath(request.nextUrl.searchParams.get("next"), "/member/orders");
  const state = createLineLoginState({ purpose: "signin", returnTo: next });
  const response = NextResponse.redirect(buildLineAuthorizeUrl(request.nextUrl.origin, "signin", state));
  response.cookies.set(LINE_SIGNIN_STATE_COOKIE, state.token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });

  return response;
}

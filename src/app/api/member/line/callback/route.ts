import { NextRequest, NextResponse } from "next/server";
import { exchangeLineCode, fetchLineProfile, LINE_STATE_COOKIE, verifyLineLoginState } from "@/lib/line/login";
import { isMemberDisabled } from "@/lib/member/status";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { appendSupabaseCookies, createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

function memberRedirect(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/member?line=${encodeURIComponent(status)}`, request.url));
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(LINE_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const cookieResponse = NextResponse.json({ ok: true });
  const supabase = createSupabaseRouteClient(request, cookieResponse);
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) {
    return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "login-required")), cookieResponse);
  }
  if (await isMemberDisabled(supabase, user.id)) {
    return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "disabled")), cookieResponse);
  }

  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const stateToken = request.cookies.get(LINE_STATE_COOKIE)?.value || "";
  const verifiedState = verifyLineLoginState(stateToken, state, user.id);

  if (!code || !verifiedState) {
    return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "invalid-state")), cookieResponse);
  }

  try {
    const token = await exchangeLineCode(request.nextUrl.origin, code, verifiedState.codeVerifier);
    if (!token.access_token) throw new Error("missing access token");
    const profile = await fetchLineProfile(token.access_token);

    const service = createSupabaseServiceClient();
    const [{ data: sameLine }, { data: sameUser }] = await Promise.all([
      service
        .from("member_line_accounts")
        .select("user_id,line_user_id")
        .eq("line_user_id", profile.userId)
        .limit(1)
        .maybeSingle(),
      service
        .from("member_line_accounts")
        .select("user_id,line_user_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
    ]);

    if (sameLine && sameLine.user_id !== user.id) {
      return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "line-already-linked")), cookieResponse);
    }
    if (sameUser && sameUser.line_user_id !== profile.userId) {
      return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "member-already-linked")), cookieResponse);
    }
    if (sameUser && sameUser.line_user_id === profile.userId) {
      return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "already-linked")), cookieResponse);
    }

    const { error: insertError } = await service
      .from("member_line_accounts")
      .insert({ user_id: user.id, line_user_id: profile.userId });

    if (insertError) {
      return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "link-failed")), cookieResponse);
    }

    return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "linked")), cookieResponse);
  } catch {
    return appendSupabaseCookies(clearStateCookie(memberRedirect(request, "link-failed")), cookieResponse);
  }
}

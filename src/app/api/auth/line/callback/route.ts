import { NextRequest, NextResponse } from "next/server";
import { exchangeLineCode, fetchLineProfile, LINE_SIGNIN_STATE_COOKIE, verifyLineLoginState } from "@/lib/line/login";
import { isMemberDisabled } from "@/lib/member/status";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

function loginRedirect(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/login?line=${encodeURIComponent(status)}`, request.url));
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(LINE_SIGNIN_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  // Everything below is gated on a genuinely-verified LINE OAuth callback.
  // No code path here ever trusts a client-supplied line_user_id or user_id.
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const stateToken = request.cookies.get(LINE_SIGNIN_STATE_COOKIE)?.value || "";
  const verifiedState = verifyLineLoginState(stateToken, state, { purpose: "signin" });

  if (!code || !verifiedState) {
    return clearStateCookie(loginRedirect(request, "failed"));
  }

  const service = createSupabaseServiceClient();

  try {
    const token = await exchangeLineCode(request.nextUrl.origin, "signin", code, verifiedState.codeVerifier);
    if (!token.access_token) throw new Error("missing access token");

    // line_user_id comes ONLY from the verified LINE profile lookup below.
    const profile = await fetchLineProfile(token.access_token);

    // user_id comes ONLY from this bound-account lookup, never from request input.
    const { data: binding } = await service
      .from("member_line_accounts")
      .select("user_id")
      .eq("line_user_id", profile.userId)
      .maybeSingle();

    if (!binding?.user_id) {
      return clearStateCookie(loginRedirect(request, "not-bound"));
    }

    if (await isMemberDisabled(service, binding.user_id)) {
      return clearStateCookie(loginRedirect(request, "disabled"));
    }

    const { data: userData, error: userError } = await service.auth.admin.getUserById(binding.user_id);
    const email = userData?.user?.email;
    if (userError || !email) {
      return clearStateCookie(loginRedirect(request, "failed"));
    }

    const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || !link?.properties?.hashed_token) {
      return clearStateCookie(loginRedirect(request, "failed"));
    }

    const response = NextResponse.redirect(new URL(verifiedState.returnTo, request.url));
    const supabase = createSupabaseRouteClient(request, response);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (verifyError) {
      return clearStateCookie(loginRedirect(request, "failed"));
    }

    return clearStateCookie(response);
  } catch {
    return clearStateCookie(loginRedirect(request, "failed"));
  }
}

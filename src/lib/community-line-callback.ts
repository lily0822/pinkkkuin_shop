import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  clearCommunityLineState,
  COMMUNITY_LINE_STATE_COOKIE,
  exchangeCommunityLineCode,
  setCommunityLineSession,
  verifyCommunityLineState,
} from "@/lib/community-line-auth";
import { fetchLineProfile } from "@/lib/line/login";

function redirectHome(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/?line=${encodeURIComponent(status)}`, request.url));
}

export async function handleCommunityLineCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const stateToken = request.cookies.get(COMMUNITY_LINE_STATE_COOKIE)?.value || "";
  const verifiedState = verifyCommunityLineState(stateToken, state);
  if (!code || !verifiedState) {
    return clearCommunityLineState(redirectHome(request, "invalid-state"), request);
  }

  try {
    const token = await exchangeCommunityLineCode(request.nextUrl.origin, code, verifiedState.codeVerifier);
    if (!token.access_token) throw new Error("missing access token");
    const profile = await fetchLineProfile(token.access_token);
    const response = redirectHome(request, "authenticated");
    setCommunityLineSession(response, request, profile.userId, profile.displayName || "");
    return clearCommunityLineState(response, request);
  } catch {
    return clearCommunityLineState(redirectHome(request, "login-failed"), request);
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  buildCommunityLineAuthorizeUrl,
  COMMUNITY_LINE_STATE_COOKIE,
  COMMUNITY_LINE_STATE_MAX_AGE,
  createCommunityLineState,
} from "@/lib/community-line-auth";
import { isLineLoginConfigured } from "@/lib/line/login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isLineLoginConfigured(request.nextUrl.origin)) {
    return NextResponse.redirect(new URL("/?line=not-configured", request.url));
  }

  const state = createCommunityLineState();
  const response = NextResponse.redirect(buildCommunityLineAuthorizeUrl(request.nextUrl.origin, state));
  response.cookies.set(COMMUNITY_LINE_STATE_COOKIE, state.token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: COMMUNITY_LINE_STATE_MAX_AGE,
  });
  return response;
}

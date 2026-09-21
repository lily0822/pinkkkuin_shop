import "server-only";

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLineLoginConfig } from "@/lib/line/login";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const COMMUNITY_LINE_STATE_COOKIE = "pinkkkuin_community_line_state";
export const COMMUNITY_LINE_SESSION_COOKIE = "pinkkkuin_community_line_session";
export const COMMUNITY_LINE_STATE_MAX_AGE = 10 * 60;
const COMMUNITY_LINE_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

type CommunityLineState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  exp: number;
};

type CommunityLineSession = {
  lineUserId: string;
  displayName: string;
  exp: number;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function signingSecret() {
  const secret = env("LINE_LOGIN_STATE_SECRET") || env("BACKEND_SESSION_SECRET") || env("SUPABASE_ANON_KEY");
  if (!secret) throw new Error("LINE Login state secret is not configured.");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function encodeSigned(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decodeSigned<T>(token: string): T | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function hashVerifier(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function createCommunityLineState() {
  const payload: CommunityLineState = {
    state: `community.${crypto.randomBytes(24).toString("base64url")}`,
    nonce: crypto.randomBytes(24).toString("base64url"),
    codeVerifier: crypto.randomBytes(48).toString("base64url"),
    exp: Math.floor(Date.now() / 1000) + COMMUNITY_LINE_STATE_MAX_AGE,
  };
  return { ...payload, token: encodeSigned(payload) };
}

export function verifyCommunityLineState(token: string, expectedState: string) {
  const payload = decodeSigned<CommunityLineState>(token);
  if (!payload || payload.state !== expectedState || !payload.state.startsWith("community.")) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.codeVerifier || !payload.nonce) return null;
  return payload;
}

export function isCommunityLineState(value: string) {
  return value.startsWith("community.");
}

export function buildCommunityLineAuthorizeUrl(origin: string, state: CommunityLineState) {
  const config = getLineLoginConfig(origin);
  if (!config.channelId || !config.channelSecret || !config.redirectUri) {
    throw new Error("LINE Login is not configured.");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.channelId,
    redirect_uri: config.redirectUri,
    state: state.state,
    scope: "profile openid",
    nonce: state.nonce,
    code_challenge: hashVerifier(state.codeVerifier),
    code_challenge_method: "S256",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

export function setCommunityLineSession(response: NextResponse, request: NextRequest, lineUserId: string, displayName: string) {
  const payload: CommunityLineSession = {
    lineUserId,
    displayName: displayName.slice(0, 120),
    exp: Math.floor(Date.now() / 1000) + COMMUNITY_LINE_SESSION_MAX_AGE,
  };
  response.cookies.set(COMMUNITY_LINE_SESSION_COOKIE, encodeSigned(payload), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: COMMUNITY_LINE_SESSION_MAX_AGE,
  });
}

export function getCommunityLineSession(request: NextRequest) {
  const token = request.cookies.get(COMMUNITY_LINE_SESSION_COOKIE)?.value || "";
  const payload = decodeSigned<CommunityLineSession>(token);
  if (!payload?.lineUserId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export async function getCommunityLineBinding(request: NextRequest) {
  const session = getCommunityLineSession(request);
  if (!session) return null;
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("community_line_bindings")
    .select("nickname")
    .eq("line_user_id", session.lineUserId)
    .maybeSingle();
  if (error || !data?.nickname) return null;
  return { lineUserId: session.lineUserId, nickname: String(data.nickname).trim() };
}

export function clearCommunityLineState(response: NextResponse, request: NextRequest) {
  response.cookies.set(COMMUNITY_LINE_STATE_COOKIE, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

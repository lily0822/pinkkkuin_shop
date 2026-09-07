import "server-only";

import crypto from "crypto";
import { getSiteOrigin } from "@/lib/supabase/config";

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";
const STATE_COOKIE_MAX_AGE = 10 * 60;
export const LINE_STATE_COOKIE = "pinkkkuin_line_login_state";

type LineStatePayload = {
  state: string;
  nonce: string;
  codeVerifier: string;
  userId: string;
  returnTo: string;
  exp: number;
};

export type LineStateCookie = LineStatePayload & {
  token: string;
};

export type LineTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
};

export type LineProfile = {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function hashVerifier(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function stateSecret() {
  const secret = env("LINE_LOGIN_STATE_SECRET") || env("BACKEND_SESSION_SECRET") || env("SUPABASE_ANON_KEY");
  if (!secret) throw new Error("LINE Login state secret is not configured.");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", stateSecret()).update(value).digest("base64url");
}

export function getLineLoginConfig(origin: string) {
  const channelId = env("LINE_LOGIN_CHANNEL_ID");
  const channelSecret = env("LINE_LOGIN_CHANNEL_SECRET");
  const redirectUri = env("LINE_LOGIN_REDIRECT_URI") || `${getSiteOrigin(origin)}/api/member/line/callback`;
  return { channelId, channelSecret, redirectUri };
}

export function isLineLoginConfigured(origin: string) {
  const config = getLineLoginConfig(origin);
  return Boolean(config.channelId && config.channelSecret && config.redirectUri);
}

export function createLineLoginState(userId: string, returnTo = "/member"): LineStateCookie {
  const payload: LineStatePayload = {
    state: crypto.randomBytes(24).toString("base64url"),
    nonce: crypto.randomBytes(24).toString("base64url"),
    codeVerifier: crypto.randomBytes(48).toString("base64url"),
    userId,
    returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/member",
    exp: Math.floor(Date.now() / 1000) + STATE_COOKIE_MAX_AGE,
  };
  const encoded = base64url(JSON.stringify(payload));
  return { ...payload, token: `${encoded}.${sign(encoded)}` };
}

export function verifyLineLoginState(token: string, expectedState: string, userId: string): LineStatePayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  let payload: LineStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LineStatePayload;
  } catch {
    return null;
  }

  if (!payload.state || payload.state !== expectedState) return null;
  if (!payload.userId || payload.userId !== userId) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.codeVerifier || !payload.nonce) return null;
  return payload;
}

export function buildLineAuthorizeUrl(origin: string, state: LineStatePayload) {
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

  return `${LINE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeLineCode(origin: string, code: string, codeVerifier: string): Promise<LineTokenResponse> {
  const config = getLineLoginConfig(origin);
  if (!config.channelId || !config.channelSecret || !config.redirectUri) {
    throw new Error("LINE Login is not configured.");
  }

  const response = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) throw new Error("LINE Login token exchange failed.");
  return (await response.json()) as LineTokenResponse;
}

export async function fetchLineProfile(accessToken: string): Promise<LineProfile> {
  const response = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("LINE profile verification failed.");

  const profile = (await response.json()) as LineProfile;
  if (!profile.userId) throw new Error("LINE profile is missing user id.");
  return profile;
}

export { STATE_COOKIE_MAX_AGE };

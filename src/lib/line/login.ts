import "server-only";

import crypto from "crypto";
import { getSiteOrigin } from "@/lib/supabase/config";

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";
const STATE_COOKIE_MAX_AGE = 10 * 60;
export const LINE_LINK_STATE_COOKIE = "pinkkkuin_line_login_state";
export const LINE_SIGNIN_STATE_COOKIE = "pinkkkuin_line_signin_state";

export type LineLoginPurpose = "link" | "signin";

type LineStatePayload = {
  purpose: LineLoginPurpose;
  state: string;
  nonce: string;
  codeVerifier: string;
  userId?: string;
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

const defaultReturnTo: Record<LineLoginPurpose, string> = {
  link: "/member/account",
  signin: "/member/orders",
};

export function getLineLoginConfig(origin: string, purpose: LineLoginPurpose) {
  const channelId = env("LINE_LOGIN_CHANNEL_ID");
  const channelSecret = env("LINE_LOGIN_CHANNEL_SECRET");
  const redirectUri =
    purpose === "signin"
      ? env("LINE_LOGIN_SIGNIN_REDIRECT_URI") || `${getSiteOrigin(origin)}/api/auth/line/callback`
      : env("LINE_LOGIN_REDIRECT_URI") || `${getSiteOrigin(origin)}/api/member/line/callback`;
  return { channelId, channelSecret, redirectUri };
}

export function isLineLoginConfigured(origin: string, purpose: LineLoginPurpose) {
  const config = getLineLoginConfig(origin, purpose);
  return Boolean(config.channelId && config.channelSecret && config.redirectUri);
}

export function createLineLoginState(options: { purpose: LineLoginPurpose; userId?: string; returnTo?: string }): LineStateCookie {
  const returnTo = options.returnTo || defaultReturnTo[options.purpose];
  const payload: LineStatePayload = {
    purpose: options.purpose,
    state: crypto.randomBytes(24).toString("base64url"),
    nonce: crypto.randomBytes(24).toString("base64url"),
    codeVerifier: crypto.randomBytes(48).toString("base64url"),
    userId: options.userId,
    returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : defaultReturnTo[options.purpose],
    exp: Math.floor(Date.now() / 1000) + STATE_COOKIE_MAX_AGE,
  };
  const encoded = base64url(JSON.stringify(payload));
  return { ...payload, token: `${encoded}.${sign(encoded)}` };
}

export function verifyLineLoginState(
  token: string,
  expectedState: string,
  expect: { purpose: LineLoginPurpose; userId?: string },
): LineStatePayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  let payload: LineStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LineStatePayload;
  } catch {
    return null;
  }

  if (!payload.state || payload.state !== expectedState) return null;
  if (payload.purpose !== expect.purpose) return null;
  if ((payload.userId || undefined) !== (expect.userId || undefined)) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.codeVerifier || !payload.nonce) return null;
  return payload;
}

export function buildLineAuthorizeUrl(origin: string, purpose: LineLoginPurpose, state: LineStatePayload) {
  const config = getLineLoginConfig(origin, purpose);
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

export async function exchangeLineCode(origin: string, purpose: LineLoginPurpose, code: string, codeVerifier: string): Promise<LineTokenResponse> {
  const config = getLineLoginConfig(origin, purpose);
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

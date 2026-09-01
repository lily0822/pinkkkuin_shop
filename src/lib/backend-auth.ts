import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const BACKEND_SESSION_COOKIE = "__Host-pinkkkuin_backend_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const TOKEN_PURPOSE = "pinkkkuin-backend-admin";

type BackendRuntime = "staging" | "production" | "unknown";

type SessionPayload = {
  purpose: string;
  iat: number;
  exp: number;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function getBackendRuntime(): BackendRuntime {
  const appEnv = env("APP_ENV").toLowerCase();
  const supabaseEnv = env("SUPABASE_ENV").toLowerCase();
  const vercelEnv = env("VERCEL_ENV").toLowerCase();

  if (appEnv === "staging" || supabaseEnv === "staging") return "staging";
  if (appEnv === "production" || supabaseEnv === "production" || vercelEnv === "production") return "production";
  return "unknown";
}

export function isBackendAuthConfigured() {
  return Boolean(env("BACKEND_ADMIN_PASSWORD") && env("BACKEND_SESSION_SECRET"));
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyBackendPassword(password: string) {
  const expected = env("BACKEND_ADMIN_PASSWORD");
  const secret = env("BACKEND_SESSION_SECRET");
  if (!expected || !secret || !password) return false;
  return safeEqual(sign(password, secret), sign(expected, secret));
}

export function createBackendSessionToken(now = Math.floor(Date.now() / 1000)) {
  const secret = env("BACKEND_SESSION_SECRET");
  if (!secret) throw new Error("Backend session is not configured.");

  const payload: SessionPayload = {
    purpose: TOKEN_PURPOSE,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyBackendSessionToken(token: string | undefined) {
  const secret = env("BACKEND_SESSION_SECRET");
  if (!secret || !token) return false;

  const [body, signature] = token.split(".");
  if (!body || !signature) return false;
  if (!safeEqual(sign(body, secret), signature)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    return payload.purpose === TOKEN_PURPOSE && typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export function isBackendSessionValid(request: NextRequest) {
  return verifyBackendSessionToken(request.cookies.get(BACKEND_SESSION_COOKIE)?.value);
}

function cookieFlags(request: NextRequest, maxAge: number) {
  const isSecure =
    request.nextUrl.protocol === "https:" ||
    env("VERCEL_ENV") === "production" ||
    process.env.NODE_ENV === "production";
  return [
    `${BACKEND_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    isSecure ? "Secure" : "",
  ].filter(Boolean);
}

export function setBackendSessionCookie(response: NextResponse, request: NextRequest, token: string) {
  const parts = cookieFlags(request, SESSION_MAX_AGE_SECONDS);
  parts[0] = `${BACKEND_SESSION_COOKIE}=${token}`;
  response.headers.append("Set-Cookie", parts.join("; "));
}

export function clearBackendSessionCookie(response: NextResponse, request: NextRequest) {
  const parts = cookieFlags(request, 0);
  parts[0] = `${BACKEND_SESSION_COOKIE}=`;
  response.headers.append("Set-Cookie", parts.join("; "));
}

export function isSameOriginMutation(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return true;

  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function backendAuthJsonError(message = "需要重新登入後台。", status = 401) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

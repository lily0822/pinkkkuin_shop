import "server-only";

import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const BACKEND_SESSION_COOKIE = "__Host-pinkkkuin_backend_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const TOKEN_PURPOSE = "pinkkkuin-backend-admin";
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

const scrypt = promisify(scryptCallback) as unknown as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

type BackendRuntime = "staging" | "production" | "unknown";

type SessionPayload = {
  purpose: string;
  iat: number;
  exp: number;
  passwordVersion: number;
};

type BackendCredential = {
  id: string;
  password_hash: string;
  password_version: number;
};

type PasswordPolicyResult = {
  ok: boolean;
  message?: string;
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
  return Boolean(env("BACKEND_SESSION_SECRET"));
}

export function shouldRequireBackendAuth() {
  const runtime = getBackendRuntime();
  if (runtime === "production") return true;
  return runtime === "staging" && Boolean(env("BACKEND_ADMIN_PASSWORD") && env("BACKEND_SESSION_SECRET"));
}

function getSupabaseAdminConfig() {
  const url = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const config = getSupabaseAdminConfig();
  if (!config) throw new Error("Backend credential storage is not configured.");

  return fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export async function fetchBackendCredential() {
  const response = await supabaseRequest(
    "/rest/v1/backend_admin_credentials?select=id,password_hash,password_version&order=updated_at.desc&limit=1",
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Unable to read backend credentials.");

  const rows = (await response.json()) as BackendCredential[];
  return rows[0] || null;
}

async function createBackendCredential(password: string) {
  const passwordHash = await hashPassword(password);
  const response = await supabaseRequest("/rest/v1/backend_admin_credentials", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      password_hash: passwordHash,
      password_version: 1,
    }),
  });
  if (!response.ok) throw new Error("Unable to create backend credentials.");

  const rows = (await response.json()) as BackendCredential[];
  return rows[0];
}

async function updateBackendCredential(id: string, password: string, passwordVersion: number) {
  const passwordHash = await hashPassword(password);
  const response = await supabaseRequest(
    `/rest/v1/backend_admin_credentials?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        password_hash: passwordHash,
        password_version: passwordVersion,
      }),
    },
  );
  if (!response.ok) throw new Error("Unable to update backend credentials.");

  const rows = (await response.json()) as BackendCredential[];
  return rows[0];
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

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  })) as Buffer;

  return [
    "scrypt",
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt,
    derivedKey.toString("base64url"),
  ].join("$");
}

async function verifyPasswordHash(password: string, encodedHash: string) {
  const [algorithm, costText, blockSizeText, parallelizationText, salt, expected] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;

  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    cost: Number(costText),
    blockSize: Number(blockSizeText),
    parallelization: Number(parallelizationText),
  })) as Buffer;

  return safeEqual(derivedKey.toString("base64url"), expected);
}

function verifyEnvPassword(password: string) {
  const expected = env("BACKEND_ADMIN_PASSWORD");
  const secret = env("BACKEND_SESSION_SECRET");
  if (!expected || !secret || !password) return false;
  return safeEqual(sign(password, secret), sign(expected, secret));
}

export function validateBackendPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 12) return { ok: false, message: "新密碼至少需要 12 個字元。" };
  if (password.trim().length !== password.length || !password.trim()) {
    return { ok: false, message: "新密碼不能只包含空白或前後空白。" };
  }
  if (!/[A-Za-z]/.test(password)) return { ok: false, message: "新密碼至少需要包含一個英文字母。" };
  if (!/[0-9\W_]/.test(password)) return { ok: false, message: "新密碼至少需要包含一個數字或符號。" };
  return { ok: true };
}

export async function verifyBackendPassword(password: string) {
  if (!password) return null;

  const credential = await fetchBackendCredential();
  if (credential) {
    const ok = await verifyPasswordHash(password, credential.password_hash);
    return ok ? credential : null;
  }

  if (!verifyEnvPassword(password)) return null;
  return createBackendCredential(password);
}

export async function changeBackendPassword(currentPassword: string, newPassword: string) {
  const credential = await fetchBackendCredential();
  if (!credential) throw new Error("尚未建立後台密碼資料。");

  const currentOk = await verifyPasswordHash(currentPassword, credential.password_hash);
  if (!currentOk) throw new Error("目前密碼不正確。");

  const policy = validateBackendPasswordPolicy(newPassword);
  if (!policy.ok) throw new Error(policy.message || "新密碼不符合安全規則。");

  const samePassword = await verifyPasswordHash(newPassword, credential.password_hash);
  if (samePassword) throw new Error("新密碼不能與目前密碼相同。");

  return updateBackendCredential(credential.id, newPassword, credential.password_version + 1);
}

export function createBackendSessionToken(passwordVersion: number, now = Math.floor(Date.now() / 1000)) {
  const secret = env("BACKEND_SESSION_SECRET");
  if (!secret) throw new Error("Backend session is not configured.");

  const payload: SessionPayload = {
    purpose: TOKEN_PURPOSE,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    passwordVersion,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

async function verifyBackendSessionToken(token: string | undefined) {
  const secret = env("BACKEND_SESSION_SECRET");
  if (!secret || !token) return false;

  const [body, signature] = token.split(".");
  if (!body || !signature) return false;
  if (!safeEqual(sign(body, secret), signature)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.purpose !== TOKEN_PURPOSE ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      typeof payload.passwordVersion !== "number"
    ) {
      return false;
    }

    const credential = await fetchBackendCredential();
    return Boolean(credential && credential.password_version === payload.passwordVersion);
  } catch {
    return false;
  }
}

export async function isBackendSessionValid(request: NextRequest) {
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

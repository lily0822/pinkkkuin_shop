import { NextRequest, NextResponse } from "next/server";
import {
  createBackendSessionToken,
  getBackendRuntime,
  isBackendAuthConfigured,
  setBackendSessionCookie,
  verifyBackendPassword,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const backendRuntime = getBackendRuntime();
  if (backendRuntime === "unknown") {
    return NextResponse.json(
      { ok: false, error: "Backend login is not available." },
      { status: 404 },
    );
  }

  if (!isBackendAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "後台登入尚未完成環境設定。" },
      { status: 503 },
    );
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "請輸入後台密碼。" },
      { status: 400 },
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  const credential = await verifyBackendPassword(password);
  if (!credential) {
    return NextResponse.json(
      { ok: false, error: "後台密碼不正確。" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true, authenticated: true });
  setBackendSessionCookie(
    response,
    request,
    createBackendSessionToken(credential.password_version),
  );
  return response;
}

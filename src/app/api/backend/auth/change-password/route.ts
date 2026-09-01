import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  changeBackendPassword,
  clearBackendSessionCookie,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const backendRuntime = getBackendRuntime();
  if (backendRuntime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (!shouldRequireBackendAuth() || !(await isBackendSessionValid(request))) {
    return backendAuthJsonError();
  }

  if (!isSameOriginMutation(request)) {
    return backendAuthJsonError("請重新整理後再操作。", 403);
  }

  let body: {
    currentPassword?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "請傳入有效的密碼資料。" },
      { status: 400 },
    );
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json(
      { ok: false, error: "請完整輸入目前密碼與新密碼。" },
      { status: 400 },
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { ok: false, error: "兩次輸入的新密碼不一致。" },
      { status: 400 },
    );
  }

  try {
    await changeBackendPassword(currentPassword, newPassword);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "變更密碼失敗。",
      },
      { status: 400 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    authenticated: false,
    message: "密碼已更新，請重新登入。",
  });
  clearBackendSessionCookie(response, request);
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { isLineAdminPushConfigured, sendLineAdminText } from "@/lib/line/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (shouldRequireBackendAuth() && !(await isBackendSessionValid(request))) {
    return backendAuthJsonError();
  }

  if (!isSameOriginMutation(request)) {
    return backendAuthJsonError("請重新整理頁面後再試一次。", 403);
  }

  return null;
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  if (!isLineAdminPushConfigured()) {
    return NextResponse.json(
      {
        success: false,
        disabled: true,
        error: "LINE 管理員通知尚未設定。",
      },
      { status: 503 },
    );
  }

  try {
    const result = await sendLineAdminText(
      [
        "Pinkkkuin LINE 管理員通知測試",
        "這是一封由後台觸發的安全測試通知。",
        "如果你收到這則訊息，代表 LINE OA Push 設定可用。",
      ].join("\n"),
    );
    return NextResponse.json({
      success: true,
      provider: result.provider,
      id: result.id,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "LINE 管理員通知發送失敗。" },
      { status: 500 },
    );
  }
}

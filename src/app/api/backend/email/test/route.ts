import { NextRequest, NextResponse } from "next/server";

import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { isStagingEmailRuntime, sendTestEmail } from "@/lib/email/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendMutation(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
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
    return backendAuthJsonError("請從後台頁面操作。", 403);
  }

  return null;
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendMutation(request);
  if (guard) return guard;

  if (!isStagingEmailRuntime()) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const result = await sendTestEmail();
    return NextResponse.json({
      success: true,
      provider: result.provider,
      id: result.id,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Email 寄送失敗" }, { status: 500 });
  }
}

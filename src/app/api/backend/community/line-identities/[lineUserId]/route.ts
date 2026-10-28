import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { unbindLiveIdentity } from "@/lib/line/live-identity-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (!isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ lineUserId: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_identities_unbind", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { lineUserId } = await params;
  const id = lineUserId?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "缺少客人的 LINE 帳號。" }, { status: 400 });

  const result = await unbindLiveIdentity(id);
  if (!result.ok) {
    if (result.error === "not_bound") {
      return NextResponse.json({ ok: false, error: "這個客人目前沒有綁定，可能已經被解除過了。" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "解除綁定失敗，請稍後再試一次。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

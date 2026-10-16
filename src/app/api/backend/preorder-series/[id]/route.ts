import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { deleteBackendSeries, SeriesInUseError } from "@/lib/backend/product-series-sync";

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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_preorder_series_delete", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "請提供正確的系列 id。" }, { status: 400 });
  }

  try {
    await deleteBackendSeries(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("deleteBackendSeries failed:", error);
    const message = error instanceof SeriesInUseError ? error.message : "預購系列刪除失敗，請稍後再試。";
    const status = error instanceof SeriesInUseError ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

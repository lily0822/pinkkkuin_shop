import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { listBackendWebsites, saveBackendWebsite, type BackendWebsitePayload } from "@/lib/backend/vendor-sync";

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

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_websites_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const websites = await listBackendWebsites();
    return NextResponse.json({ ok: true, websites });
  } catch (error) {
    console.error("listBackendWebsites failed:", error);
    return NextResponse.json({ ok: false, error: "購物網站讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_websites_save", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: BackendWebsitePayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的購物網站資料。" }, { status: 400 });
  }

  if (!payload?.name) {
    return NextResponse.json({ ok: false, error: "請填寫購物網站名稱。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendWebsite(payload);
    return NextResponse.json({ ok: true, website: saved });
  } catch (error) {
    console.error("saveBackendWebsite failed:", error);
    return NextResponse.json({ ok: false, error: "購物網站儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

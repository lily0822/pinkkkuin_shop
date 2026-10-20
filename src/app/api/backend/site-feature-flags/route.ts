import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { getSiteFeatureFlags, saveSiteFeatureFlags } from "@/lib/site-feature-flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest, mutation = false) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_site_feature_flags_get", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const flags = await getSiteFeatureFlags();
    return NextResponse.json({ ok: true, flags });
  } catch {
    return NextResponse.json({ ok: false, error: "網站功能開關讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_site_feature_flags_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { flags?: Partial<Record<string, unknown>> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的設定資料。" }, { status: 400 });
  }

  const incoming = body.flags && typeof body.flags === "object" ? body.flags : {};

  try {
    const saved = await saveSiteFeatureFlags(incoming);
    revalidateTag("site-feature-flags", "max");
    return NextResponse.json({ ok: true, flags: saved });
  } catch {
    return NextResponse.json({ ok: false, error: "網站功能開關儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

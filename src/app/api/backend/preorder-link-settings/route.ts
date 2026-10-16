import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { DEFAULT_PREORDER_LINK_SETTINGS, getPreorderLinkSettings, savePreorderLinkSettings } from "@/lib/line/preorder-link-settings";

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

  const rate = await backendRateLimit(request, "backend_preorder_link_settings_get", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const settings = await getPreorderLinkSettings();
    return NextResponse.json({ ok: true, ...settings, defaults: DEFAULT_PREORDER_LINK_SETTINGS });
  } catch {
    return NextResponse.json({ ok: false, error: "預購連結設定讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_preorder_link_settings_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { returningKeyword?: unknown; oaMessagePrefix?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的設定資料。" }, { status: 400 });
  }

  try {
    const saved = await savePreorderLinkSettings(body);
    return NextResponse.json({ ok: true, ...saved });
  } catch {
    return NextResponse.json({ ok: false, error: "預購連結設定儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

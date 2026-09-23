import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import {
  DEFAULT_COMMUNITY_LINE_TEMPLATES,
  getCommunityLineTemplates,
  saveCommunityLineTemplate,
} from "@/lib/line/community-notification-templates";
import { COMMUNITY_LINE_NOTIFICATION_KINDS, type CommunityLineNotificationKind } from "@/lib/line/community-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
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

  const rate = await backendRateLimit(request, "backend_community_line_templates_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const templates = await getCommunityLineTemplates();
    return NextResponse.json({ ok: true, templates, defaults: DEFAULT_COMMUNITY_LINE_TEMPLATES });
  } catch {
    return NextResponse.json({ ok: false, error: "訊息範本讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_templates_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { kind?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的範本資料。" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  if (!COMMUNITY_LINE_NOTIFICATION_KINDS.includes(kind as CommunityLineNotificationKind)) {
    return NextResponse.json({ ok: false, error: "請選擇正確的通知類型。" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "請輸入訊息內容。" }, { status: 400 });
  }

  try {
    const templates = await saveCommunityLineTemplate(kind as CommunityLineNotificationKind, text);
    return NextResponse.json({ ok: true, templates });
  } catch {
    return NextResponse.json({ ok: false, error: "訊息範本儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

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
  DEFAULT_LIVESTREAM_REPLY_TEMPLATES,
  getLivestreamReplyTemplates,
  saveLivestreamReplyTemplate,
  LIVESTREAM_REPLY_TEMPLATE_KEYS,
  type LivestreamReplyTemplateKey,
} from "@/lib/line/livestream-reply-templates";

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

  const rate = await backendRateLimit(request, "backend_livestream_reply_templates_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const templates = await getLivestreamReplyTemplates();
    return NextResponse.json({ ok: true, templates, defaults: DEFAULT_LIVESTREAM_REPLY_TEMPLATES });
  } catch {
    return NextResponse.json({ ok: false, error: "訊息文案讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_livestream_reply_templates_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { key?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的文案資料。" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!LIVESTREAM_REPLY_TEMPLATE_KEYS.includes(key as LivestreamReplyTemplateKey)) {
    return NextResponse.json({ ok: false, error: "請選擇正確的訊息類型。" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "請輸入訊息內容。" }, { status: 400 });
  }

  try {
    const templates = await saveLivestreamReplyTemplate(key as LivestreamReplyTemplateKey, text);
    return NextResponse.json({ ok: true, templates });
  } catch {
    return NextResponse.json({ ok: false, error: "訊息文案儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

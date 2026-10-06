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
  DEFAULT_LIVESTREAM_KEYWORD_ENABLED,
  DEFAULT_LIVESTREAM_KEYWORDS,
  LIVESTREAM_KEYWORD_GROUPS,
  findDuplicateKeywords,
  getLivestreamKeywordSettings,
  saveLivestreamKeywords,
  type LivestreamKeywords,
} from "@/lib/line/livestream-keywords";

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

  const rate = await backendRateLimit(request, "backend_community_livestream_keywords_get", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const { keywords, enabled } = await getLivestreamKeywordSettings();
    return NextResponse.json({
      ok: true,
      keywords,
      enabled,
      defaults: DEFAULT_LIVESTREAM_KEYWORDS,
      defaultsEnabled: DEFAULT_LIVESTREAM_KEYWORD_ENABLED,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "關鍵字設定讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_keywords_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { keywords?: Partial<Record<string, unknown>>; enabled?: Partial<Record<string, unknown>>; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的設定資料。" }, { status: 400 });
  }

  const incoming = body.keywords && typeof body.keywords === "object" ? body.keywords : {};
  const groups = {} as LivestreamKeywords;
  LIVESTREAM_KEYWORD_GROUPS.forEach((group) => {
    groups[group] = Array.isArray(incoming[group]) ? (incoming[group] as string[]) : [];
  });

  if (LIVESTREAM_KEYWORD_GROUPS.every((group) => !groups[group].length)) {
    return NextResponse.json({ ok: false, error: "請至少為每一組輸入關鍵字。" }, { status: 400 });
  }

  // enabled 只接受 boolean，其他型別或缺漏的組別預設 true（啟用）——
  // 實際的 sanitize/fallback 邏輯在 saveLivestreamKeywords 內部做，這裡
  // 只負責把 body 原始帶過去，不用在路由層重複一份驗證規則。
  const incomingEnabled = body.enabled && typeof body.enabled === "object" ? body.enabled : {};

  const duplicates = findDuplicateKeywords(groups);
  if (duplicates.length && body.force !== true) {
    return NextResponse.json({ ok: false, needsConfirm: true, duplicates });
  }

  try {
    const saved = await saveLivestreamKeywords(groups, incomingEnabled);
    return NextResponse.json({ ok: true, keywords: saved.keywords, enabled: saved.enabled });
  } catch {
    return NextResponse.json({ ok: false, error: "關鍵字設定儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

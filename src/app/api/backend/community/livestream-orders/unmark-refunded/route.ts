import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { getCurrentOrMostRecentSession } from "@/lib/line/livestream-sessions";

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

type Body = { lineUserId?: unknown; sessionId?: unknown };

// 「取消退款標記」——跟 mark-refunded 同一支客人/場次解析規則，呼叫
// unmark_livestream_customer_refunded RPC 把 paid_amount 加回
// refunded_amount、清空 refunded_at/refunded_amount。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_unmark_refunded", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const lineUserId = typeof body.lineUserId === "string" ? body.lineUserId.trim() : "";
  if (!lineUserId) return NextResponse.json({ ok: false, error: "缺少客人的 LINE 帳號。" }, { status: 400 });

  const sessionIdParam = typeof body.sessionId === "string" ? body.sessionId : "";

  try {
    const supabase = createSupabaseServiceClient();

    let resolvedSessionId: string | null = null;
    if (sessionIdParam === "unassigned") {
      resolvedSessionId = null;
    } else if (sessionIdParam) {
      resolvedSessionId = sessionIdParam;
    } else {
      const defaultSession = await getCurrentOrMostRecentSession(supabase);
      resolvedSessionId = defaultSession?.id || null;
    }

    const { data: count, error } = await supabase.rpc("unmark_livestream_customer_refunded", {
      p_line_user_id: lineUserId,
      p_session_id: resolvedSessionId,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, count: Number(count || 0) });
  } catch {
    return NextResponse.json({ ok: false, error: "取消退款標記失敗，請稍後再試。" }, { status: 500 });
  }
}

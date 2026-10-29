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

// 階段二（結算模型）：「標記已退款」——針對「指定客人、指定場次」目前
// refundDue>0 的全部項目一次處理（呼叫 202610290003 migration 新增的
// mark_livestream_customer_refunded RPC，單一 UPDATE 陳述式、天生原子、
// 重複呼叫不會重複記錄）。sessionId 沿用跟 GET .../livestream-orders 同一
// 套解析規則：空字串＝「當下連線／最近一場」、"unassigned"＝場次欄位是
// null 的舊資料、其餘當成明確的場次 id——交給後端解析，前端永遠只傳目前
// 畫面上選的那個原始篩選值，不用自己猜 default 是哪一場。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_mark_refunded", 30);
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

    const { data: count, error } = await supabase.rpc("mark_livestream_customer_refunded", {
      p_line_user_id: lineUserId,
      p_session_id: resolvedSessionId,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, count: Number(count || 0) });
  } catch {
    return NextResponse.json({ ok: false, error: "標記已退款失敗，請稍後再試。" }, { status: 500 });
  }
}

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
import {
  COMMUNITY_LINE_NOTIFICATION_KINDS,
  sendCommunityOrderNotifications,
  type CommunityLineNotificationKind,
} from "@/lib/line/community-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ORDER_IDS = 200;

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

  const rate = await backendRateLimit(request, "backend_community_line_notifications_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_line_notifications")
      .select("id, kind, target_id, nickname, status, error_message, sent_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      notifications: (data || []).map((row) => ({
        id: String(row.id || ""),
        kind: String(row.kind || ""),
        targetId: String(row.target_id || ""),
        nickname: String(row.nickname || ""),
        status: String(row.status || "not_notified"),
        errorMessage: row.error_message ? String(row.error_message) : "",
        sentAt: row.sent_at ? String(row.sent_at) : "",
        createdAt: String(row.created_at || ""),
        updatedAt: String(row.updated_at || ""),
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "LINE 通知紀錄讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_notifications_send", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { orderIds?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的通知資料。" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  if (!COMMUNITY_LINE_NOTIFICATION_KINDS.includes(kind as CommunityLineNotificationKind)) {
    return NextResponse.json({ ok: false, error: "請選擇正確的通知類型。" }, { status: 400 });
  }

  const orderIds = Array.isArray(body.orderIds)
    ? Array.from(new Set(body.orderIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim())))
    : [];
  if (!orderIds.length) {
    return NextResponse.json({ ok: false, error: "請至少勾選一筆訂單。" }, { status: 400 });
  }
  if (orderIds.length > MAX_ORDER_IDS) {
    return NextResponse.json({ ok: false, error: `一次最多通知 ${MAX_ORDER_IDS} 筆訂單。` }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data: orderRows, error } = await supabase
      .from("community_orders")
      .select("id, nickname")
      .in("id", orderIds);
    if (error) throw error;

    const orders = (Array.isArray(orderRows) ? orderRows : [])
      .map((row) => ({ orderId: String(row.id || ""), nickname: String(row.nickname || "") }))
      .filter((row) => row.orderId && row.nickname);

    const results = await sendCommunityOrderNotifications(kind as CommunityLineNotificationKind, orders);
    const successCount = results.filter((result) => result.status === "sent").length;
    const failedCount = results.length - successCount;

    return NextResponse.json({ ok: true, results, successCount, failedCount });
  } catch {
    return NextResponse.json({ ok: false, error: "LINE 通知發送失敗，請稍後再試。" }, { status: 500 });
  }
}

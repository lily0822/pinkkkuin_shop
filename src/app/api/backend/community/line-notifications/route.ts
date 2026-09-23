import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
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

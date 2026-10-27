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

type SessionRow = { id: string; name: string; starts_at: string; ends_at: string };

// 同一時間只能有一個場次——這裡先查一次重疊給出可讀的錯誤訊息
// （「和「某某場次」的時間重疊了」），資料庫的 exclusion constraint 是
// 最後一道防線，不應該讓它的錯誤直接炸給前端。excludeId 給 PATCH 用
// （編輯自己不算跟自己重疊）。
async function findOverlappingSession(
  startsAt: string,
  endsAt: string,
  excludeId?: string,
): Promise<SessionRow | null> {
  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("community_livestream_sessions")
    .select("id, name, starts_at, ends_at")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.limit(1).maybeSingle();
  return (data as SessionRow | null) || null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_sessions_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("community_livestream_sessions")
    .select("id, name, starts_at, ends_at")
    .order("starts_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "場次讀取失敗，請稍後再試。" }, { status: 500 });
  }

  const sessions = (data as SessionRow[] | null) || [];
  // N 位客人・M 種商品——只算 order_status='submitted' 的訂單，暫存中的
  // staged 照片不算數（那些本來就還沒歸到任何場次）。
  const stats = await Promise.all(
    sessions.map(async (session) => {
      const { data: orderRows } = await supabase
        .from("community_livestream_orders")
        .select("line_user_id")
        .eq("session_id", session.id)
        .eq("order_status", "submitted");
      const rows = (orderRows as { line_user_id: string | null }[] | null) || [];
      const customerCount = new Set(rows.map((row) => row.line_user_id).filter(Boolean)).size;
      return { ...session, customerCount, productCount: rows.length };
    }),
  );

  return NextResponse.json({ ok: true, sessions: stats });
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_sessions_create", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { name?: unknown; startsAt?: unknown; endsAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的場次資料。" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
  if (!name) return NextResponse.json({ ok: false, error: "請輸入場次名稱。" }, { status: 400 });
  const startsDate = new Date(startsAt);
  const endsDate = new Date(endsAt);
  if (Number.isNaN(startsDate.getTime()) || Number.isNaN(endsDate.getTime())) {
    return NextResponse.json({ ok: false, error: "請輸入正確的開始/結束時間。" }, { status: 400 });
  }
  if (endsDate <= startsDate) {
    return NextResponse.json({ ok: false, error: "結束時間要晚於開始時間。" }, { status: 400 });
  }

  const overlap = await findOverlappingSession(startsDate.toISOString(), endsDate.toISOString());
  if (overlap) {
    return NextResponse.json(
      { ok: false, error: `和「${overlap.name}」的時間重疊了，同一時間只能有一個場次。` },
      { status: 409 },
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("community_livestream_sessions")
    .insert({ name, starts_at: startsDate.toISOString(), ends_at: endsDate.toISOString() })
    .select("id, name, starts_at, ends_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: "場次新增失敗，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, session: data });
}

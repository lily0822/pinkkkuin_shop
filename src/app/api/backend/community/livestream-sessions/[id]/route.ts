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

async function findOverlappingSession(
  startsAt: string,
  endsAt: string,
  excludeId: string,
): Promise<SessionRow | null> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("community_livestream_sessions")
    .select("id, name, starts_at, ends_at")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .neq("id", excludeId)
    .limit(1)
    .maybeSingle();
  return (data as SessionRow | null) || null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_sessions_update", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await context.params;

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

  const overlap = await findOverlappingSession(startsDate.toISOString(), endsDate.toISOString(), id);
  if (overlap) {
    return NextResponse.json(
      { ok: false, error: `和「${overlap.name}」的時間重疊了，同一時間只能有一個場次。` },
      { status: 409 },
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("community_livestream_sessions")
    .update({ name, starts_at: startsDate.toISOString(), ends_at: endsDate.toISOString() })
    .eq("id", id)
    .select("id, name, starts_at, ends_at")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "場次更新失敗，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, session: data });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_sessions_delete", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await context.params;
  const supabase = createSupabaseServiceClient();

  const { count } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id);
  if (count) {
    return NextResponse.json({ ok: false, error: "這個場次已經有訂單，不能刪除。" }, { status: 409 });
  }

  const { error } = await supabase.from("community_livestream_sessions").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, error: "場次刪除失敗，請稍後再試。" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

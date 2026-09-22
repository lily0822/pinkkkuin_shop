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

const ALLOWED_SNIPE_STATUSES = new Set(["pending", "won", "lost"]);

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
  if (!isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_order_items_update", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const itemId = id?.trim();
  if (!itemId) {
    return NextResponse.json({ ok: false, error: "請提供正確的商品資料。" }, { status: 400 });
  }

  let body: { snipeStatus?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的搶購狀態。" }, { status: 400 });
  }

  const snipeStatus = typeof body.snipeStatus === "string" ? body.snipeStatus.trim() : "";
  if (!ALLOWED_SNIPE_STATUSES.has(snipeStatus)) {
    return NextResponse.json({ ok: false, error: "請提供正確的搶購狀態。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.rpc("backend_update_community_order_item", {
      p_item_id: itemId,
      p_snipe_status: snipeStatus,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, snipeStatus });
  } catch {
    return NextResponse.json({ ok: false, error: "搶購狀態更新失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_order_items_delete", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const itemId = id?.trim() || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)) {
    return NextResponse.json({ ok: false, error: "請提供正確的商品資料。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("delete_community_order_item", { p_item_id: itemId });
    if (error) throw error;
    if (data !== true) {
      return NextResponse.json({ ok: false, error: "找不到這筆商品。" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "商品刪除失敗，請稍後再試。" }, { status: 500 });
  }
}

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
import { notifyCommunityBought } from "@/lib/line/community-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_SNIPE_STATUSES = new Set(["pending", "won", "lost"]);
const ALLOWED_PURCHASE_STATUSES = new Set(["bought", "not_bought"]);
const ALLOWED_ITEM_ARRIVAL_STATUSES = new Set(["not_arrived", "arrived", "exception"]);

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

  let body: { snipeStatus?: unknown; purchaseStatus?: unknown; itemArrivalStatus?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的搶購狀態。" }, { status: 400 });
  }

  const snipeStatus = typeof body.snipeStatus === "string" ? body.snipeStatus.trim() : null;
  const purchaseStatus = typeof body.purchaseStatus === "string" ? body.purchaseStatus.trim() : null;
  const itemArrivalStatus = typeof body.itemArrivalStatus === "string" ? body.itemArrivalStatus.trim() : null;
  if (snipeStatus !== null && !ALLOWED_SNIPE_STATUSES.has(snipeStatus)) {
    return NextResponse.json({ ok: false, error: "請提供正確的搶購狀態。" }, { status: 400 });
  }
  if (purchaseStatus !== null && !ALLOWED_PURCHASE_STATUSES.has(purchaseStatus)) {
    return NextResponse.json({ ok: false, error: "請提供正確的購買狀態。" }, { status: 400 });
  }
  if (itemArrivalStatus !== null && !ALLOWED_ITEM_ARRIVAL_STATUSES.has(itemArrivalStatus)) {
    return NextResponse.json({ ok: false, error: "請提供正確的到貨狀態。" }, { status: 400 });
  }
  if (snipeStatus === null && purchaseStatus === null && itemArrivalStatus === null) {
    return NextResponse.json({ ok: false, error: "請提供要更新的商品狀態。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    if (snipeStatus !== null) {
      const { error } = await supabase.rpc("backend_update_community_order_item", {
        p_item_id: itemId,
        p_snipe_status: snipeStatus,
      });
      if (error) throw error;
    }

    if (purchaseStatus !== null || itemArrivalStatus !== null) {
      const updates: Record<string, string> = {};
      if (purchaseStatus !== null) updates.purchase_status = purchaseStatus;
      if (itemArrivalStatus !== null) updates.arrival_status = itemArrivalStatus;
      const { data, error } = await supabase
        .from("community_order_items")
        .update(updates)
        .eq("id", itemId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json({ ok: false, error: "找不到這項商品。" }, { status: 404 });
      }
    }

    if (purchaseStatus === "bought") {
      try {
        const { data: itemRow } = await supabase
          .from("community_order_items")
          .select("product_name, order_id")
          .eq("id", itemId)
          .maybeSingle();
        const orderId = itemRow?.order_id ? String(itemRow.order_id) : "";
        if (orderId) {
          const { data: orderRow } = await supabase
            .from("community_orders")
            .select("nickname")
            .eq("id", orderId)
            .maybeSingle();
          const nickname = orderRow?.nickname ? String(orderRow.nickname) : "";
          if (nickname) {
            await notifyCommunityBought(itemId, nickname, String(itemRow?.product_name || ""));
          }
        }
      } catch {
        // Notification is best-effort and must never affect the status update response.
      }
    }

    return NextResponse.json({ ok: true, snipeStatus, purchaseStatus, itemArrivalStatus });
  } catch {
    return NextResponse.json({ ok: false, error: "商品狀態更新失敗，請稍後再試。" }, { status: 500 });
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

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
import { sendLineUserText } from "@/lib/line/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PURCHASE_STATUSES = new Set(["not_bought", "confirming", "bought"]);
const PAYMENT_STATUSES = new Set(["unpaid", "confirming", "paid"]);

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

type LivestreamOrderPatch = {
  productName?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
  purchaseStatus?: unknown;
  paymentStatus?: unknown;
  notes?: unknown;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_update", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const orderId = id?.trim();
  if (!orderId) return NextResponse.json({ ok: false, error: "缺少訂單識別資料。" }, { status: 400 });

  let body: LivestreamOrderPatch;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的更新資料。" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.productName === "string") patch.product_name = body.productName.trim().slice(0, 300) || null;
  if (body.unitPrice === null) patch.unit_price = null;
  else if (typeof body.unitPrice === "number" && Number.isFinite(body.unitPrice) && body.unitPrice >= 0) patch.unit_price = body.unitPrice;
  if (typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0) patch.quantity = Math.round(body.quantity);
  if (typeof body.purchaseStatus === "string" && PURCHASE_STATUSES.has(body.purchaseStatus)) patch.purchase_status = body.purchaseStatus;
  if (typeof body.paymentStatus === "string" && PAYMENT_STATUSES.has(body.paymentStatus)) patch.payment_status = body.paymentStatus;
  if (typeof body.notes === "string") patch.notes = body.notes.trim().slice(0, 2000) || null;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "沒有可更新的欄位。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data: before, error: beforeError } = await supabase
      .from("community_livestream_orders")
      .select("line_user_id, product_name, purchase_status, confirmed_notified_at")
      .eq("id", orderId)
      .maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return NextResponse.json({ ok: false, error: "找不到這筆訂單。" }, { status: 404 });

    // 功能四：只在「第一次」轉為已購買時才 push 通知客人，之後的任何編輯
    // （改備註、改數量等）都不會重複發送。這是本功能唯一會計入 LINE 月費
    // 訊息額度的動作，其餘都是 reply。
    const willConfirmNow = patch.purchase_status === "bought" && before.purchase_status !== "bought" && !before.confirmed_notified_at;
    if (willConfirmNow) patch.confirmed_notified_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("community_livestream_orders")
      .update(patch)
      .eq("id", orderId)
      .select("id, line_user_id, product_name, quantity")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ ok: false, error: "更新失敗，請重新整理後再試。" }, { status: 409 });

    let notified = false;
    if (willConfirmNow && updated.line_user_id) {
      try {
        const label = updated.product_name ? `「${updated.product_name}」×${updated.quantity}` : "您的訂單";
        await sendLineUserText(String(updated.line_user_id), `${label} 訂單已確認，謝謝您的購買！`);
        notified = true;
      } catch {
        // The status update itself already succeeded and confirmed_notified_at
        // is already set (no retry queue for this v1 — matches how other LINE
        // push failures in this codebase are already just logged, not queued).
      }
    }

    return NextResponse.json({ ok: true, notified });
  } catch {
    return NextResponse.json({ ok: false, error: "社群連線訂單更新失敗，請稍後再試。" }, { status: 500 });
  }
}

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

const PURCHASE_STATUSES = new Set(["not_bought", "bought"]);
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
    // 已移除訂單確認 LINE push 通知（原本是本功能唯一計入月費額度的動作，
    // 使用者決定不需要）。標記已購買現在單純是狀態更新，不對客人發任何
    // 訊息。confirmed_notified_at 欄位仍留在資料表裡，只是不再讀寫。
    const { data: updated, error: updateError } = await supabase
      .from("community_livestream_orders")
      .update(patch)
      .eq("id", orderId)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ ok: false, error: "更新失敗，請重新整理後再試。" }, { status: 409 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "社群連線訂單更新失敗，請稍後再試。" }, { status: 500 });
  }
}

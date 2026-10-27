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
import { deleteLivestreamOrder } from "@/lib/line/livestream-orders";

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
  purchasedQuantity?: unknown;
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
  // 連線代購下單改版 第二階段：管理員改單價一律寫回 customer_unit_price
  // （往後唯一的有效單價欄位），不再寫舊的 unit_price——GET 列表路由回應
  // 的 unitPrice 本來就是「customer_unit_price 優先、沒有才退回
  // unit_price」算出來的，這裡寫新欄位才會跟那個顯示邏輯一致。
  if (body.unitPrice === null) {
    patch.customer_unit_price = null;
  } else if (typeof body.unitPrice === "number" && Number.isFinite(body.unitPrice) && body.unitPrice >= 0) {
    patch.customer_unit_price = body.unitPrice;
  }
  // 管理員透過「單價可直接編輯」改動單價，視為已經處理完客人回報的
  // 「價格有誤」——自動清掉標記跟建議金額，不用另外按一顆清除按鈕。
  if ("customer_unit_price" in patch) {
    patch.price_disputed_at = null;
    patch.price_dispute_suggested_price = null;
  }
  if (typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0) patch.quantity = Math.round(body.quantity);
  // 「買到幾個」：null 代表重設回未採買，否則是 ≥0 整數——不特別跟
  // quantity 比上限，買到比訂購數量多理論上可能發生，後端不擋，交給
  // 管理員自行判斷是否合理。寫入的同時讓 purchase_status 自動跟著衍生
  // （null→未購買、其餘→已購買），維持既有程式碼（客人自助取消、我要
  // 匯款）讀 purchase_status 的邏輯不用改。
  if (body.purchasedQuantity === null) {
    patch.purchased_quantity = null;
    patch.purchase_status = "not_bought";
  } else if (
    typeof body.purchasedQuantity === "number" &&
    Number.isFinite(body.purchasedQuantity) &&
    body.purchasedQuantity >= 0
  ) {
    patch.purchased_quantity = Math.round(body.purchasedQuantity);
    patch.purchase_status = "bought";
  }
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_delete", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const orderId = id?.trim();
  if (!orderId) return NextResponse.json({ ok: false, error: "缺少訂單識別資料。" }, { status: 400 });

  try {
    const supabase = createSupabaseServiceClient();
    // Hard delete, shared with 功能六's LINE self-cancel flow
    // (src/lib/line/livestream-orders.ts::deleteLivestreamOrder) — this table
    // is a brand-new, simple, fully independent design, not the older
    // community_orders/community_order_items safe-delete path. The photo in
    // the private storage bucket (if any) is left orphaned, not cleaned up.
    const ok = await deleteLivestreamOrder(supabase, orderId);
    if (!ok) return NextResponse.json({ ok: false, error: "刪除失敗，請稍後再試。" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "刪除失敗，請稍後再試。" }, { status: 500 });
  }
}

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
  // 連線代購下單改版 第三階段：管理員改單價改寫 seller_unit_price（跟
  // 客人自己填的 customer_unit_price 分開保存），不再寫第二階段那樣
  // 共用同一欄位——匯款金額計算需要「賣家單價 ?? 客人單價」這種
  // fallback，一旦共用欄位，賣家改價就會把客人原始輸入永久蓋掉，沒辦法
  // 再做這個 fallback。GET 列表路由的 unitPrice 回應值對應改成
  // 「seller_unit_price ?? customer_unit_price ?? unit_price」。
  if (body.unitPrice === null) {
    patch.seller_unit_price = null;
  } else if (typeof body.unitPrice === "number" && Number.isFinite(body.unitPrice) && body.unitPrice >= 0) {
    patch.seller_unit_price = body.unitPrice;
  }
  // 管理員透過「單價可直接編輯」改動單價，視為已經處理完客人回報的
  // 「價格有誤」——自動清掉標記跟建議金額，不用另外按一顆清除按鈕。
  if ("seller_unit_price" in patch) {
    patch.price_disputed_at = null;
    patch.price_dispute_suggested_price = null;
  }
  if (typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0) patch.quantity = Math.round(body.quantity);
  // 「買到幾個」：null 代表重設回未採買，否則是 ≥0 整數；上限（不能
  // 超過訂購數量）交給資料庫 CHECK constraint
  // （community_livestream_orders_purchased_quantity_cap，第三階段
  // migration）擋，下面 catch 區塊偵測違反 constraint 的錯誤碼 23514
  // 轉成友善訊息，這裡不用先查一次 quantity 才能驗證。寫入的同時讓
  // purchase_status 自動跟著衍生（null→未購買、其餘→已購買），維持
  // 既有程式碼（客人自助取消、我要匯款）讀 purchase_status 的邏輯
  // 不用改。
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
    if (updateError) {
      // 23514 = check_violation——這裡唯一可能違反的 CHECK constraint 是
      // 「買到幾個不能超過訂購數量」，查一次目前的 quantity 組出帶數字的
      // 友善訊息（只有真的超過上限才會走到這個分支，不是每次 PATCH 都查）。
      if (updateError.code === "23514" && "purchased_quantity" in patch) {
        const { data: orderRow } = await supabase
          .from("community_livestream_orders")
          .select("quantity")
          .eq("id", orderId)
          .maybeSingle();
        const quantity = orderRow?.quantity ? Number(orderRow.quantity) : null;
        return NextResponse.json(
          { ok: false, error: quantity ? `買到的數量不能超過訂購數量（${quantity}）。` : "買到的數量不能超過訂購數量。" },
          { status: 400 },
        );
      }
      throw updateError;
    }
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

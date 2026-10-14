import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { listBackendOrders, saveBackendOrder, type BackendOrderPayload } from "@/lib/backend/order-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 叫貨處/廠商/購物網站/客戶訂單明細共用的同一張 backend_orders 表。
// 刻意叫 vendor-orders 不叫 orders，因為 /api/backend/orders 這個路徑
// 已經是另一個完全不同的功能在用（storefront 客人訂單管理），不是
// 這裡講的叫貨明細，避免路徑撞名。
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

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_vendor_orders_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const orders = await listBackendOrders();
    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    console.error("listBackendOrders failed:", error);
    return NextResponse.json({ ok: false, error: "訂單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_vendor_orders_save", 40);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: BackendOrderPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的訂單資料。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendOrder(payload);
    return NextResponse.json({ ok: true, order: saved });
  } catch (error) {
    console.error("saveBackendOrder failed:", error);
    return NextResponse.json({ ok: false, error: "訂單儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

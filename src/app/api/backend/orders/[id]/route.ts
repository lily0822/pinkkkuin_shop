import { NextRequest, NextResponse } from "next/server";
import { fetchEmailOrderById, sendOrderCancelledEmail } from "@/lib/email/order-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isStagingRuntime() {
  return (
    process.env.APP_ENV?.trim().toLowerCase() === "staging" ||
    process.env.SUPABASE_ENV?.trim().toLowerCase() === "staging"
  );
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function cleanStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function callOrderRpc(rpcName: string, body: Record<string, unknown>) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return {
      ok: false,
      status: 500,
      result: { message: "Staging backend order API is not configured." },
    };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let result: unknown = null;
  try {
    result = rawText ? JSON.parse(rawText) : null;
  } catch {
    result = rawText;
  }
  return { ok: response.ok, status: response.status, result };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isStagingRuntime()) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const { id } = await params;
  const orderId = typeof id === "string" ? id.trim() : "";
  if (!orderId) return jsonError("Order id is required.");

  let body: {
    status?: unknown;
    paymentStatus?: unknown;
    shippingStatus?: unknown;
    action?: unknown;
    cancelReason?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.");
  }

  const action = cleanStatus(body.action);
  const status = cleanStatus(body.status);
  const paymentStatus = cleanStatus(body.paymentStatus);
  const shippingStatus = cleanStatus(body.shippingStatus);

  if (action === "cancel" || status === "cancelled") {
    const cancelReason = typeof body.cancelReason === "string" ? body.cancelReason.trim() : "";
    if (!cancelReason) return jsonError("取消訂單需要填寫原因。");
    const rpc = await callOrderRpc("cancel_storefront_order", {
      p_order_id: orderId,
      p_cancel_reason: cancelReason,
    });
    if (!rpc.ok) {
      const message =
        typeof rpc.result === "object" && rpc.result && "message" in rpc.result
          ? String((rpc.result as { message?: unknown }).message || "")
          : "";
      return jsonError(message || "取消訂單失敗。", rpc.status >= 500 ? 500 : 400);
    }
    const emailOrder = await fetchEmailOrderById(orderId);
    await sendOrderCancelledEmail(emailOrder);
    return NextResponse.json({ ok: true, order: rpc.result });
  }

  const allowedOrder = new Set(["pending", "processing", "completed"]);
  const allowedPayment = new Set(["pending", "paid", "failed", "refunded"]);
  const allowedShipping = new Set(["pending", "preparing", "shipped", "completed", "cancelled"]);

  if (status && !allowedOrder.has(status)) return jsonError("不支援的訂單狀態。");
  if (paymentStatus && !allowedPayment.has(paymentStatus)) return jsonError("不支援的付款狀態。");
  if (shippingStatus && !allowedShipping.has(shippingStatus)) return jsonError("不支援的配送狀態。");

  const rpc = await callOrderRpc("update_storefront_order_status", {
    p_order_id: orderId,
    p_status: status || null,
    p_payment_status: paymentStatus || null,
    p_shipping_status: shippingStatus || null,
  });
  if (!rpc.ok) {
    const message =
      typeof rpc.result === "object" && rpc.result && "message" in rpc.result
        ? String((rpc.result as { message?: unknown }).message || "")
        : "";
    return jsonError(message || "更新訂單狀態失敗。", rpc.status >= 500 ? 500 : 400);
  }

  return NextResponse.json({ ok: true, order: rpc.result });
}

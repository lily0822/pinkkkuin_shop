import { NextRequest, NextResponse } from "next/server";
import { fetchEmailOrderById, sendOrderCancelledEmail } from "@/lib/email/order-notifications";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SupabaseOrder = {
  id: string;
  order_no: string | null;
  order_type: string | null;
  checkout_group_id: string | null;
  created_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  delivery_method: string | null;
  delivery_address: string | null;
  payment_method: string | null;
  status: string | null;
  payment_status: string | null;
  shipping_status: string | null;
  subtotal: number | string | null;
  shipping_fee: number | string | null;
  discount_amount: number | string | null;
  total: number | string | null;
  notes: string | null;
  convenience_store_type: string | null;
  convenience_store_id: string | null;
  convenience_store_name: string | null;
  convenience_store_address: string | null;
  payment_transaction_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  order_items?: SupabaseOrderItem[];
};

type SupabaseOrderItem = {
  id: string;
  product_name: string | null;
  variant_spec: string | null;
  unit_price: number | string | null;
  quantity: number | string | null;
  subtotal: number | string | null;
  product_url: string | null;
  product_type: string | null;
};

const ALLOWED_ORDER_TYPES = new Set(["stock", "preorder"]);
const ALLOWED_ORDER_STATUSES = new Set([
  "pending",
  "processing",
  "completed",
  "cancelled",
]);
const ALLOWED_PAYMENT_STATUSES = new Set([
  "pending",
  "paid",
  "failed",
  "refunded",
]);
const ALLOWED_SHIPPING_STATUSES = new Set([
  "pending",
  "preparing",
  "shipped",
  "completed",
  "cancelled",
]);
const ALLOWED_PAGE_SIZES = new Set([10, 20, 50]);

function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "staging") return null;
  if (runtime !== "production") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (!isBackendSessionValid(request)) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請重新整理後再操作。", 403);
  return null;
}

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeOrderItem(item: SupabaseOrderItem) {
  const unitPrice = toNumber(item.unit_price);
  const quantity = Math.max(0, Math.floor(toNumber(item.quantity)));
  return {
    id: item.id,
    productName: item.product_name || "",
    variantSpec: item.variant_spec || "",
    unitPrice,
    quantity,
    subtotal: toNumber(item.subtotal) || unitPrice * quantity,
    productUrl: item.product_url || "",
    productType: item.product_type || "",
  };
}

function normalizeOrder(order: SupabaseOrder) {
  return {
    id: order.id,
    orderNo: order.order_no || "",
    orderType: order.order_type || "",
    checkoutGroupId: order.checkout_group_id || "",
    createdAt: order.created_at || "",
    customerName: order.customer_name || "",
    customerPhone: order.customer_phone || "",
    customerEmail: order.customer_email || "",
    recipientName: order.recipient_name || "",
    recipientPhone: order.recipient_phone || "",
    deliveryMethod: order.delivery_method || "",
    deliveryAddress: order.delivery_address || "",
    convenienceStoreType: order.convenience_store_type || "",
    convenienceStoreId: order.convenience_store_id || "",
    convenienceStoreName: order.convenience_store_name || "",
    convenienceStoreAddress: order.convenience_store_address || "",
    paymentMethod: order.payment_method || "",
    paymentTransactionId: order.payment_transaction_id || "",
    cancelReason: order.cancel_reason || "",
    cancelledAt: order.cancelled_at || "",
    status: order.status || "",
    paymentStatus: order.payment_status || "",
    shippingStatus: order.shipping_status || "",
    subtotal: toNumber(order.subtotal),
    shippingFee: toNumber(order.shipping_fee),
    discountAmount: toNumber(order.discount_amount),
    total: toNumber(order.total),
    notes: order.notes || "",
    items: Array.isArray(order.order_items)
      ? order.order_items.map(normalizeOrderItem)
      : [],
  };
}

function cleanTextParam(value: string | null) {
  return (value || "").trim();
}

function cleanEnumParam(value: string | null, allowed: Set<string>) {
  const normalized = cleanTextParam(value).toLowerCase();
  if (!normalized || normalized === "all") return "";
  return allowed.has(normalized) ? normalized : "";
}

function cleanSearchPattern(value: string) {
  return value.replace(/[%*(),]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPageParam(value: string | null) {
  const page = Number.parseInt(value || "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function cleanPageSizeParam(value: string | null) {
  const pageSize = Number.parseInt(value || "", 10);
  return ALLOWED_PAGE_SIZES.has(pageSize) ? pageSize : 10;
}

function taipeiDateBoundary(dateValue: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return "";
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${dateValue}T${time}+08:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function buildOrderQueryUrl(supabaseUrl: string, requestUrl: string, selectQuery: string) {
  const incoming = new URL(requestUrl);
  const url = new URL(`${supabaseUrl}/rest/v1/orders`);
  url.searchParams.set("select", selectQuery);
  url.searchParams.set("order", "created_at.desc,id.desc");

  const q = cleanSearchPattern(cleanTextParam(incoming.searchParams.get("q")));
  if (q) {
    const searchFields = [
      "order_no",
      "customer_name",
      "recipient_name",
      "customer_phone",
      "recipient_phone",
      "customer_email",
    ];
    url.searchParams.set(
      "or",
      `(${searchFields.map((field) => `${field}.ilike.*${q}*`).join(",")})`,
    );
  }

  const dateFrom = taipeiDateBoundary(
    cleanTextParam(incoming.searchParams.get("date_from")),
  );
  const dateTo = taipeiDateBoundary(
    cleanTextParam(incoming.searchParams.get("date_to")),
    true,
  );
  if (dateFrom) url.searchParams.set("created_at", `gte.${dateFrom}`);
  if (dateTo) url.searchParams.append("created_at", `lte.${dateTo}`);

  const orderType = cleanEnumParam(
    incoming.searchParams.get("order_type"),
    ALLOWED_ORDER_TYPES,
  );
  const status = cleanEnumParam(
    incoming.searchParams.get("status"),
    ALLOWED_ORDER_STATUSES,
  );
  const paymentStatus = cleanEnumParam(
    incoming.searchParams.get("payment_status"),
    ALLOWED_PAYMENT_STATUSES,
  );
  const shippingStatus = cleanEnumParam(
    incoming.searchParams.get("shipping_status"),
    ALLOWED_SHIPPING_STATUSES,
  );
  if (orderType) url.searchParams.set("order_type", `eq.${orderType}`);
  if (status) url.searchParams.set("status", `eq.${status}`);
  if (paymentStatus) url.searchParams.set("payment_status", `eq.${paymentStatus}`);
  if (shippingStatus) url.searchParams.set("shipping_status", `eq.${shippingStatus}`);

  return url;
}

function orderRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

function parseExactCount(contentRange: string | null, fallback: number) {
  const totalText = contentRange?.split("/")?.[1] || "";
  const total = Number.parseInt(totalText, 10);
  return Number.isFinite(total) && total >= 0 ? total : fallback;
}

async function fetchOrdersPage(
  url: URL,
  supabaseKey: string,
  page: number,
  pageSize: number,
) {
  const { from, to } = orderRange(page, pageSize);
  const requestUrl = new URL(url.toString());
  requestUrl.searchParams.set("offset", String(from));
  requestUrl.searchParams.set("limit", String(pageSize));

  const response = await fetch(requestUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "count=exact",
      Range: `${from}-${to}`,
      "Range-Unit": "items",
    },
    cache: "no-store",
  });

  const rawText = await response.text();
  let result: unknown = null;
  try {
    result = rawText ? JSON.parse(rawText) : null;
  } catch {
    result = rawText;
  }

  return {
    response,
    result,
    total: parseExactCount(
      response.headers.get("content-range"),
      Array.isArray(result) ? result.length : 0,
    ),
  };
}

export async function GET(request: NextRequest) {
  const guard = guardBackendRequest(request);
  if (guard) return guard;

  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: "Staging backend order API is not configured." },
      { status: 500 },
    );
  }

  const query = [
    "id",
    "order_no",
    "order_type",
    "checkout_group_id",
    "created_at",
    "customer_name",
    "customer_phone",
    "customer_email",
    "recipient_name",
    "recipient_phone",
    "delivery_method",
    "delivery_address",
    "payment_method",
    "status",
    "payment_status",
    "shipping_status",
    "subtotal",
    "shipping_fee",
    "discount_amount",
    "total",
    "notes",
    "convenience_store_type",
    "convenience_store_id",
    "convenience_store_name",
    "convenience_store_address",
    "payment_transaction_id",
    "cancel_reason",
    "cancelled_at",
    "order_items(id,product_name,variant_spec,unit_price,quantity,subtotal,product_url,product_type)",
  ].join(",");

  const incoming = new URL(request.url);
  const requestedPage = cleanPageParam(incoming.searchParams.get("page"));
  const pageSize = cleanPageSizeParam(incoming.searchParams.get("page_size"));
  const orderQueryUrl = buildOrderQueryUrl(supabaseUrl, request.url, query);

  let page = requestedPage;
  let { response, result, total } = await fetchOrdersPage(
    orderQueryUrl,
    supabaseKey,
    page,
    pageSize,
  );

  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  if (totalPages > 0 && page > totalPages) {
    page = totalPages;
    const retry = await fetchOrdersPage(orderQueryUrl, supabaseKey, page, pageSize);
    response = retry.response;
    result = retry.result;
    total = retry.total;
    if (!response.ok) {
      const message =
        typeof result === "object" && result && "message" in result
          ? String((result as { message?: unknown }).message || "")
          : "";
      return NextResponse.json(
        { ok: false, error: message || "載入訂單失敗，請稍後再試。" },
        { status: response.status },
      );
    }
  }

  if (!response.ok) {
    const message =
      typeof result === "object" && result && "message" in result
        ? String((result as { message?: unknown }).message || "")
        : "";
    return NextResponse.json(
      { ok: false, error: message || "載入訂單失敗，請稍後再試。" },
      { status: response.status },
    );
  }

  const orders = Array.isArray(result) ? result.map(normalizeOrder) : [];
  return NextResponse.json({
    ok: true,
    orders,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: total > 0 ? Math.ceil(total / pageSize) : 0,
    },
  });
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function cleanStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function callOrderRpc(
  rpcName: string,
  body: Record<string, unknown>,
) {
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

export async function PATCH(request: NextRequest) {
  const guard = guardBackendRequest(request, true);
  if (guard) return guard;

  let body: {
    id?: unknown;
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

  const orderId = typeof body.id === "string" ? body.id.trim() : "";
  if (!orderId) return jsonError("Order id is required.");

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

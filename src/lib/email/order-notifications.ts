import "server-only";

import { sendEmail } from "./client";
import { renderOrderCancelledEmail } from "./templates/order-cancelled";
import { renderOrderCreatedEmail } from "./templates/order-created";

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
  payment_status: string | null;
  subtotal: number | string | null;
  shipping_fee: number | string | null;
  discount_amount: number | string | null;
  total: number | string | null;
  convenience_store_name: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  order_items?: SupabaseOrderItem[];
};

export type EmailOrderItem = {
  productName: string;
  variantSpec: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  productUrl: string;
  productType: string;
};

export type EmailOrder = {
  id: string;
  orderNo: string;
  orderType: string;
  checkoutGroupId: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  recipientName: string;
  recipientPhone: string;
  deliveryMethod: string;
  deliveryAddress: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  convenienceStoreName: string;
  cancelReason: string;
  cancelledAt: string;
  items: EmailOrderItem[];
};

const ORDER_EMAIL_SELECT = [
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
  "payment_status",
  "subtotal",
  "shipping_fee",
  "discount_amount",
  "total",
  "convenience_store_name",
  "cancel_reason",
  "cancelled_at",
  "order_items(id,product_name,variant_spec,unit_price,quantity,subtotal,product_url,product_type)",
].join(",");

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeOrderItem(item: SupabaseOrderItem): EmailOrderItem {
  const unitPrice = toNumber(item.unit_price);
  const quantity = Math.max(0, Math.floor(toNumber(item.quantity)));
  return {
    productName: item.product_name || "",
    variantSpec: item.variant_spec || "",
    unitPrice,
    quantity,
    subtotal: toNumber(item.subtotal) || unitPrice * quantity,
    productUrl: item.product_url || "",
    productType: item.product_type || "",
  };
}

function normalizeOrder(order: SupabaseOrder): EmailOrder {
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
    paymentMethod: order.payment_method || "",
    paymentStatus: order.payment_status || "",
    subtotal: toNumber(order.subtotal),
    shippingFee: toNumber(order.shipping_fee),
    discountAmount: toNumber(order.discount_amount),
    total: toNumber(order.total),
    convenienceStoreName: order.convenience_store_name || "",
    cancelReason: order.cancel_reason || "",
    cancelledAt: order.cancelled_at || "",
    items: Array.isArray(order.order_items) ? order.order_items.map(normalizeOrderItem) : [],
  };
}

function getSupabaseEmailConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    "";
  return { url, key };
}

function logOrderEmail(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

async function fetchOrders(url: URL): Promise<EmailOrder[]> {
  const config = getSupabaseEmailConfig();
  if (!config.url || !config.key) {
    logOrderEmail("order_email_fetch_skipped", { reason: "missing_supabase_env" });
    return [];
  }

  const response = await fetch(url, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
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

  if (!response.ok || !Array.isArray(result)) {
    logOrderEmail("order_email_fetch_failed", {
      status: response.status,
      message:
        result && typeof result === "object" && "message" in result
          ? String((result as { message?: unknown }).message || "")
          : "orders fetch failed",
    });
    return [];
  }

  return result.map((order) => normalizeOrder(order as SupabaseOrder));
}

export async function fetchEmailOrdersByOrderNos(orderNos: string[]): Promise<EmailOrder[]> {
  const cleanOrderNos = orderNos.map((orderNo) => orderNo.trim()).filter(Boolean);
  const config = getSupabaseEmailConfig();
  if (!config.url || cleanOrderNos.length === 0) return [];
  const url = new URL(`${config.url}/rest/v1/orders`);
  url.searchParams.set("select", ORDER_EMAIL_SELECT);
  url.searchParams.set("order", "created_at.asc,id.asc");
  url.searchParams.set("order_no", `in.(${cleanOrderNos.map((orderNo) => `"${orderNo.replace(/"/g, '\\"')}"`).join(",")})`);
  return fetchOrders(url);
}

export async function fetchEmailOrderById(orderId: string): Promise<EmailOrder | null> {
  const config = getSupabaseEmailConfig();
  const cleanOrderId = orderId.trim();
  if (!config.url || !cleanOrderId) return null;
  const url = new URL(`${config.url}/rest/v1/orders`);
  url.searchParams.set("select", ORDER_EMAIL_SELECT);
  url.searchParams.set("id", `eq.${cleanOrderId}`);
  url.searchParams.set("limit", "1");
  const orders = await fetchOrders(url);
  return orders[0] || null;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendOrderCreatedEmail(orders: EmailOrder[]) {
  const validOrders = orders.filter((order) => order.orderNo);
  if (!validOrders.length) {
    logOrderEmail("order_created_email_skipped", { reason: "missing_orders" });
    return null;
  }

  const customerEmail = validOrders[0]?.customerEmail || "";
  if (!isValidEmail(customerEmail)) {
    logOrderEmail("order_created_email_skipped", {
      reason: "missing_customer_email",
      order_no: validOrders.map((order) => order.orderNo).join(","),
      checkout_group_id: validOrders[0]?.checkoutGroupId || "",
    });
    return null;
  }

  try {
    const email = renderOrderCreatedEmail(validOrders);
    const result = await sendEmail({
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    console.info(
      JSON.stringify({
        event: "order_created_email_sent",
        order_no: validOrders.map((order) => order.orderNo).join(","),
        checkout_group_id: validOrders[0]?.checkoutGroupId || "",
        provider_message_id: result.id,
      }),
    );
    return result;
  } catch (error) {
    logOrderEmail("order_created_email_failed", {
      order_no: validOrders.map((order) => order.orderNo).join(","),
      checkout_group_id: validOrders[0]?.checkoutGroupId || "",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function sendOrderCancelledEmail(order: EmailOrder | null) {
  if (!order?.orderNo) {
    logOrderEmail("order_cancelled_email_skipped", { reason: "missing_order" });
    return null;
  }

  if (!isValidEmail(order.customerEmail)) {
    logOrderEmail("order_cancelled_email_skipped", {
      reason: "missing_customer_email",
      order_no: order.orderNo,
      checkout_group_id: order.checkoutGroupId,
    });
    return null;
  }

  try {
    const email = renderOrderCancelledEmail(order);
    const result = await sendEmail({
      to: order.customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    console.info(
      JSON.stringify({
        event: "order_cancelled_email_sent",
        order_no: order.orderNo,
        checkout_group_id: order.checkoutGroupId,
        provider_message_id: result.id,
      }),
    );
    return result;
  } catch (error) {
    logOrderEmail("order_cancelled_email_failed", {
      order_no: order.orderNo,
      checkout_group_id: order.checkoutGroupId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchEmailOrdersByOrderNos, sendOrderCreatedEmail } from "@/lib/email/order-notifications";

type CheckoutItemInput = {
  productId?: unknown;
  variantId?: unknown;
  quantity?: unknown;
};

type CheckoutPayload = {
  customer?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
  };
  recipient?: {
    name?: unknown;
    phone?: unknown;
  };
  shipping?: {
    method?: unknown;
    postalCode?: unknown;
    address?: unknown;
    meetupConfirmed?: unknown;
    meetup_confirmed?: unknown;
  };
  payment?: {
    method?: unknown;
  };
  items?: CheckoutItemInput[];
  note?: unknown;
};

type StorefrontOrderResult = {
  orderNo?: string;
  orderType?: string;
  checkoutGroupId?: string;
  subtotal?: number;
  shippingFee?: number;
  discountAmount?: number;
  total?: number;
  paymentStatus?: string;
  shippingStatus?: string;
  status?: string;
};

type StorefrontRpcResult = {
  checkoutGroupId?: string;
  orders?: StorefrontOrderResult[];
} & StorefrontOrderResult;

type ProductTypeRow = {
  id: string;
  legacy_id: string | null;
  product_type: "stock" | "preorder";
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuantity(value: unknown) {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function normalizeBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizePayload(input: CheckoutPayload) {
  return {
    customer: {
      name: text(input.customer?.name),
      phone: text(input.customer?.phone),
      email: text(input.customer?.email),
    },
    recipient: {
      name: text(input.recipient?.name),
      phone: text(input.recipient?.phone),
    },
    shipping: {
      method: text(input.shipping?.method),
      postalCode: text(input.shipping?.postalCode),
      address: text(input.shipping?.method) === "home_delivery" ? text(input.shipping?.address) : "",
      meetupConfirmed:
        text(input.shipping?.method) === "meetup"
          ? normalizeBoolean(input.shipping?.meetupConfirmed ?? input.shipping?.meetup_confirmed)
          : false,
    },
    payment: {
      method: text(input.payment?.method) || "pending",
    },
    note: text(input.note),
    items: Array.isArray(input.items)
      ? input.items.map((item) => ({
          productId: text(item.productId),
          variantId: text(item.variantId) || null,
          quantity: normalizeQuantity(item.quantity),
        }))
      : [],
  };
}

function isTaiwanMobile(value: string) {
  return /^09\d{8}$/.test(value);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.items.length) return "購物車是空的，請先選擇商品。";
  if (!payload.customer.name) return "請填寫顧客姓名。";
  if (!isTaiwanMobile(payload.customer.phone)) return "請填寫 09 開頭的 10 位手機號碼。";
  if (!isEmail(payload.customer.email)) return "請填寫正確的 Email。";
  if (!payload.recipient.name) return "請填寫收件人姓名。";
  if (!isTaiwanMobile(payload.recipient.phone)) return "請填寫收件人 09 開頭的 10 位手機號碼。";
  if (!payload.shipping.method) return "請選擇配送方式。";
  if (payload.shipping.method === "convenience_store") return "超商取貨尚未開放，請先選擇宅配。";
  if (payload.shipping.method === "home_delivery" && !payload.shipping.address) return "請填寫配送地址。";
  if (payload.shipping.method === "meetup" && !payload.shipping.meetupConfirmed) return "請先確認 LINE 面交。";
  return "";
}

function normalizeOrders(result: unknown) {
  const rpcResult = result as StorefrontRpcResult | null;
  if (Array.isArray(rpcResult?.orders)) return rpcResult.orders;
  if (rpcResult && typeof rpcResult === "object" && rpcResult.orderNo) return [rpcResult];
  return [];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function postgrestInList(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
}

async function fetchProductTypes(supabaseUrl: string, supabaseKey: string, productIds: string[]) {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const uuidIds = uniqueIds.filter(isUuid);
  const legacyIds = uniqueIds.filter((id) => !isUuid(id));
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  async function read(path: string) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers, cache: "no-store" });
    if (!response.ok) throw new Error("商品資料驗證失敗，請稍後再試。");
    return (await response.json()) as ProductTypeRow[];
  }

  const rows: ProductTypeRow[] = [];
  const select = encodeURIComponent("id,legacy_id,product_type");
  if (uuidIds.length) {
    rows.push(...await read(`products?select=${select}&id=in.(${postgrestInList(uuidIds)})`));
  }
  if (legacyIds.length) {
    rows.push(...await read(`products?select=${select}&legacy_id=in.(${postgrestInList(legacyIds)})`));
  }

  return rows;
}

async function validateMeetupItems(payload: ReturnType<typeof normalizePayload>, supabaseUrl: string, supabaseKey: string) {
  if (payload.shipping.method !== "meetup") return "";
  const productRows = await fetchProductTypes(supabaseUrl, supabaseKey, payload.items.map((item) => item.productId));
  const typeById = new Map<string, ProductTypeRow["product_type"]>();
  productRows.forEach((row) => {
    typeById.set(row.id, row.product_type);
    if (row.legacy_id) typeById.set(row.legacy_id, row.product_type);
  });

  const hasPreorder = payload.items.some((item) => typeById.get(item.productId) === "preorder");
  if (hasPreorder) return "本次訂單含預購商品，無法使用面交。";
  const hasMissingProduct = payload.items.some((item) => !typeById.has(item.productId));
  if (hasMissingProduct) return "商品資料驗證失敗，請重新整理後再試。";
  return "";
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) return jsonError("訂單系統尚未設定完成。", 500);

  let body: CheckoutPayload;
  try {
    body = await request.json();
  } catch {
    return jsonError("送出的資料格式不正確。");
  }

  const payload = normalizePayload(body);
  const validationError = validatePayload(payload);
  if (validationError) return jsonError(validationError);
  try {
    const meetupError = await validateMeetupItems(payload, supabaseUrl, supabaseKey);
    if (meetupError) return jsonError(meetupError);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "商品資料驗證失敗，請稍後再試。", 500);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_storefront_order`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });

  const rawText = await response.text();
  let result: unknown = null;
  try {
    result = rawText ? JSON.parse(rawText) : null;
  } catch {
    result = rawText;
  }

  if (!response.ok) {
    const message =
      typeof result === "object" && result && "message" in result
        ? String((result as { message?: unknown }).message || "")
        : "";
    return jsonError(message || "訂單建立失敗，請稍後再試。", response.status >= 500 ? 500 : 400);
  }

  const orders = normalizeOrders(result);
  const checkoutGroupId =
    result && typeof result === "object" && "checkoutGroupId" in result
      ? String((result as { checkoutGroupId?: unknown }).checkoutGroupId || "")
      : orders[0]?.checkoutGroupId || "";

  const emailOrders = await fetchEmailOrdersByOrderNos(
    orders.map((order) => order.orderNo || "").filter(Boolean),
  );
  await sendOrderCreatedEmail(emailOrders);

  return NextResponse.json({
    ok: true,
    checkoutGroupId: checkoutGroupId || null,
    orders,
    order: orders[0] || null,
  });
}

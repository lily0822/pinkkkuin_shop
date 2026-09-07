import "server-only";

import { formatTwd } from "@/lib/email/utils";
import type { EmailOrder, EmailOrderItem } from "@/lib/email/order-notifications";
import { isPublicHttpsImageUrl } from "@/lib/product-default-image";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendLineUserFlex } from "./client";

export type MemberLineNotificationEvent =
  | "order_created"
  | "order_cancelled"
  | "payment_completed"
  | "order_shipped";

export type MemberLineNotificationSettings = Record<MemberLineNotificationEvent, boolean>;

const SETTINGS_TYPE = "member-line-notifications";
const MAX_VISIBLE_ITEMS = 5;

export const DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS: MemberLineNotificationSettings = {
  order_created: false,
  order_cancelled: false,
  payment_completed: false,
  order_shipped: false,
};

type FlexComponent = Record<string, unknown>;

function logMemberLine(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "line",
      scope: "member",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function safeText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function orderTypeLabel(value: string) {
  if (value === "stock") return "現貨";
  if (value === "preorder") return "預購";
  return "訂單";
}

function paymentMethodLabel(value: string) {
  if (value === "bank_transfer" || value === "pending" || !value) return "銀行轉帳";
  if (value === "meetup") return "面交付款";
  if (value === "line_pay") return "LINE Pay";
  if (value === "cash") return "現金";
  return value;
}

function statusLabel(kind: "order" | "payment" | "shipping", value: string) {
  const maps = {
    order: {
      pending: "待處理",
      processing: "處理中",
      completed: "已完成",
      cancelled: "已取消",
    },
    payment: {
      pending: "待付款",
      paid: "已付款",
      failed: "付款失敗",
      refunded: "已退款",
    },
    shipping: {
      pending: "待處理",
      preparing: "備貨中",
      shipped: "已出貨",
      completed: "已完成",
      cancelled: "已取消",
    },
  };
  return maps[kind][value as keyof (typeof maps)[typeof kind]] || value || "未設定";
}

function compactItemName(item: EmailOrderItem) {
  const productName = safeText(item.productName, "未命名商品");
  const spec = item.variantSpec.trim();
  return spec ? `${productName}（${spec}）` : productName;
}

function itemQuantity(item: EmailOrderItem) {
  const quantity = Math.floor(Number(item.quantity));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function text(
  value: string,
  options: {
    size?: string;
    color?: string;
    weight?: string;
    align?: string;
    wrap?: boolean;
    flex?: number;
    margin?: string;
  } = {},
): FlexComponent {
  return {
    type: "text",
    text: value,
    size: options.size || "sm",
    color: options.color || "#4B5563",
    weight: options.weight,
    align: options.align,
    wrap: options.wrap ?? true,
    flex: options.flex,
    margin: options.margin,
  };
}

function divider(margin = "md"): FlexComponent {
  return {
    type: "separator",
    margin,
    color: "#F9A8D4",
  };
}

function keyValue(label: string, value: string): FlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      text(label, { size: "xs", color: "#9CA3AF", flex: 0 }),
      text(value, { size: "sm", color: "#374151", weight: "bold", align: "end", flex: 1 }),
    ],
  };
}

function itemRow(item: EmailOrderItem): FlexComponent {
  const quantity = itemQuantity(item);
  const subtotal = Number(item.subtotal) || Number(item.unitPrice) * quantity || 0;
  const imageUrl = item.imageUrl.trim();
  const contents: FlexComponent[] = [];

  if (isPublicHttpsImageUrl(imageUrl)) {
    contents.push({
      type: "image",
      url: imageUrl,
      size: "sm",
      aspectRatio: "1:1",
      aspectMode: "cover",
      flex: 0,
    });
  }

  contents.push({
    type: "box",
    layout: "vertical",
    spacing: "xs",
    flex: 1,
    contents: [
      text(compactItemName(item), { size: "sm", color: "#111827", weight: "bold" }),
      text(`數量：${quantity}`, { size: "xs", color: "#6B7280" }),
    ],
  });

  contents.push(text(formatTwd(subtotal), { size: "sm", color: "#111827", weight: "bold", align: "end", flex: 0 }));

  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "md",
    contents,
  };
}

function itemRows(items: EmailOrderItem[]): FlexComponent[] {
  const safeItems = items.length
    ? items
    : [{
        productId: "",
        productName: "未命名商品",
        variantSpec: "",
        unitPrice: 0,
        quantity: 1,
        subtotal: 0,
        productUrl: "",
        productType: "",
        imageUrl: "",
      }];
  const visibleItems = safeItems.slice(0, MAX_VISIBLE_ITEMS);
  const hiddenCount = safeItems.length - visibleItems.length;
  const rows = visibleItems.map(itemRow);

  if (hiddenCount > 0) {
    rows.push(text(`另有 ${hiddenCount} 項商品`, { size: "xs", color: "#9CA3AF", margin: "md" }));
  }

  return rows;
}

function bubble(title: string, subtitle: string, bodyContents: FlexComponent[], headerColors = {
  background: "#E8F5E9",
  title: "#2E7D32",
}): Record<string, unknown> {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      paddingAll: "16px",
      backgroundColor: headerColors.background,
      contents: [
        text(title, { size: "lg", color: headerColors.title, weight: "bold" }),
        text(subtitle, { size: "xs", color: "#6B7280" }),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: bodyContents,
    },
  };
}

function orderSection(order: EmailOrder): FlexComponent[] {
  return [
    keyValue(`${orderTypeLabel(order.orderType)}訂單`, order.orderNo),
    ...itemRows(order.items),
    keyValue("小計", formatTwd(order.total)),
  ];
}

function createdFlex(orders: EmailOrder[]) {
  if (orders.length > 1) {
    const firstOrder = orders[0];
    const total = orders.reduce((sum, order) => sum + order.total, 0);
    return bubble("訂單成立｜現貨＋預購", safeText(firstOrder?.checkoutGroupId, "mixed checkout"), [
      keyValue("訂單", orders.map((order) => order.orderNo).join("、")),
      divider(),
      ...orders.flatMap((order, index) => [
        ...(index > 0 ? [divider()] : []),
        ...orderSection(order),
      ]),
      divider(),
      keyValue("合計", formatTwd(total)),
      keyValue("付款方式", paymentMethodLabel(firstOrder?.paymentMethod || "")),
    ]);
  }

  const order = orders[0];
  return bubble(`訂單成立｜${orderTypeLabel(order.orderType)}`, order.orderNo, [
    text("我們已收到你的訂單，會依照後續通知處理。", { size: "sm", color: "#4B5563" }),
    divider(),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("付款方式", paymentMethodLabel(order.paymentMethod)),
  ]);
}

function cancelledFlex(order: EmailOrder) {
  const contents: FlexComponent[] = [
    keyValue("訂單編號", order.orderNo),
    divider(),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("付款狀態", statusLabel("payment", order.paymentStatus)),
    keyValue("取消原因", safeText(order.cancelReason, "未提供")),
  ];

  if (order.paymentStatus === "paid") {
    contents.push(text("已付款訂單取消，請留意退款處理。", {
      size: "xs",
      color: "#B45309",
      weight: "bold",
      margin: "md",
    }));
  }

  return bubble(`訂單已取消｜${orderTypeLabel(order.orderType)}`, order.orderNo, contents, {
    background: "#FFF1F2",
    title: "#BE185D",
  });
}

function paymentCompletedFlex(order: EmailOrder) {
  return bubble(`付款完成｜${orderTypeLabel(order.orderType)}`, order.orderNo, [
    keyValue("訂單編號", order.orderNo),
    divider(),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("訂單狀態", statusLabel("order", order.status)),
    keyValue("付款狀態", statusLabel("payment", "paid")),
  ]);
}

function shippedFlex(order: EmailOrder) {
  return bubble(`訂單已出貨｜${orderTypeLabel(order.orderType)}`, order.orderNo, [
    keyValue("訂單編號", order.orderNo),
    divider(),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("出貨狀態", statusLabel("shipping", "shipped")),
  ]);
}

function normalizeSettings(input: unknown): MemberLineNotificationSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS };
  const record = input as Record<string, unknown>;
  return {
    order_created: record.order_created === true,
    order_cancelled: record.order_cancelled === true,
    payment_completed: record.payment_completed === true,
    order_shipped: record.order_shipped === true,
  };
}

export function serializeMemberLineNotificationSettings(settings: MemberLineNotificationSettings) {
  return JSON.stringify(normalizeSettings(settings));
}

export function parseMemberLineNotificationSettings(value: string | null | undefined) {
  try {
    return normalizeSettings(value ? JSON.parse(value) : null);
  } catch {
    return { ...DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS };
  }
}

export async function getMemberLineNotificationSettings() {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("schedule_settings")
    .select("image")
    .eq("type", SETTINGS_TYPE)
    .maybeSingle();

  if (error) {
    logMemberLine("member_line_settings_fetch_failed", { message: error.message });
    return { ...DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS };
  }

  return parseMemberLineNotificationSettings(data?.image);
}

export async function saveMemberLineNotificationSettings(settings: MemberLineNotificationSettings) {
  const supabase = createSupabaseServiceClient();
  const normalized = normalizeSettings(settings);
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({
      legacy_id: SETTINGS_TYPE,
      type: SETTINGS_TYPE,
      image: serializeMemberLineNotificationSettings(normalized),
    }, { onConflict: "type" });

  if (error) throw error;
  return normalized;
}

async function getLineBindingByUserId(userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("member_line_accounts")
    .select("line_user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logMemberLine("member_line_binding_fetch_failed", { message: error.message });
    return "";
  }

  return typeof data?.line_user_id === "string" ? data.line_user_id.trim() : "";
}

function notificationFlex(event: MemberLineNotificationEvent, orders: EmailOrder[]) {
  const order = orders[0];
  if (event === "order_created") return createdFlex(orders);
  if (event === "order_cancelled") return cancelledFlex(order);
  if (event === "payment_completed") return paymentCompletedFlex(order);
  return shippedFlex(order);
}

function notificationAltText(event: MemberLineNotificationEvent, orders: EmailOrder[]) {
  const orderNos = orders.map((order) => order.orderNo).filter(Boolean).join("、");
  if (event === "order_created") return `Pinkkkuin 訂單成立：${orderNos}`;
  if (event === "order_cancelled") return `Pinkkkuin 訂單已取消：${orderNos}`;
  if (event === "payment_completed") return `Pinkkkuin 付款完成：${orderNos}`;
  return `Pinkkkuin 訂單已出貨：${orderNos}`;
}

export async function sendMemberLineOrderNotification(
  event: MemberLineNotificationEvent,
  orders: EmailOrder[] | EmailOrder | null,
) {
  const orderList = (Array.isArray(orders) ? orders : orders ? [orders] : []).filter((order) => order.orderNo);
  if (!orderList.length) {
    logMemberLine("member_line_notification_skipped", { event, reason: "missing_order" });
    return null;
  }

  const userIds = Array.from(new Set(orderList.map((order) => order.userId).filter(Boolean)));
  if (userIds.length !== 1) {
    logMemberLine("member_line_notification_skipped", {
      event,
      reason: userIds.length ? "mixed_user_ids" : "guest_order",
      order_no: orderList.map((order) => order.orderNo).join(","),
    });
    return null;
  }

  try {
    const settings = await getMemberLineNotificationSettings();
    if (!settings[event]) {
      logMemberLine("member_line_notification_skipped", {
        event,
        reason: "disabled",
        order_no: orderList.map((order) => order.orderNo).join(","),
      });
      return null;
    }

    const lineUserId = await getLineBindingByUserId(userIds[0]);
    if (!lineUserId) {
      logMemberLine("member_line_notification_skipped", {
        event,
        reason: "not_linked",
        order_no: orderList.map((order) => order.orderNo).join(","),
      });
      return null;
    }

    const result = await sendLineUserFlex(
      lineUserId,
      notificationAltText(event, orderList),
      notificationFlex(event, orderList),
    );
    console.info(
      JSON.stringify({
        event: "member_line_notification_sent",
        notification_event: event,
        order_no: orderList.map((order) => order.orderNo).join(","),
        checkout_group_id: orderList[0]?.checkoutGroupId || "",
        provider_message_id: result.id,
      }),
    );
    return result;
  } catch (error) {
    logMemberLine("member_line_notification_failed", {
      event,
      order_no: orderList.map((order) => order.orderNo).join(","),
      checkout_group_id: orderList[0]?.checkoutGroupId || "",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

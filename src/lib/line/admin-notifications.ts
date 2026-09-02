import "server-only";

import { formatTwd } from "@/lib/email/utils";
import type { EmailOrder, EmailOrderItem } from "@/lib/email/order-notifications";
import { isPublicHttpsImageUrl } from "@/lib/product-default-image";
import { sendLineAdminFlex } from "./client";

const MAX_VISIBLE_ITEMS = 5;

type FlexComponent = Record<string, unknown>;

function orderTypeLabel(value: string): string {
  if (value === "stock") return "現貨";
  if (value === "preorder") return "預購";
  return "訂單";
}

function paymentMethodLabel(value: string): string {
  if (value === "bank_transfer" || value === "pending" || !value) return "銀行轉帳";
  if (value === "meetup") return "面交付款";
  return value;
}

function paymentStatusLabel(value: string): string {
  if (value === "pending" || !value) return "待付款";
  if (value === "paid") return "已付款";
  if (value === "failed") return "付款失敗";
  if (value === "refunded") return "已退款";
  return value;
}

function safeText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function compactItemName(item: EmailOrderItem): string {
  const productName = safeText(item.productName, "未命名商品");
  const spec = item.variantSpec?.trim();
  return spec ? `${productName}（${spec}）` : productName;
}

function itemQuantity(item: EmailOrderItem): number {
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
  const imageUrl = item.imageUrl?.trim() || "";
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
  const safeItems = items.length ? items : [{
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

function logLineNotification(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "line",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function bubble(
  title: string,
  subtitle: string,
  bodyContents: FlexComponent[],
  headerColors: { background: string; title: string } = {
    background: "#FFF1F2",
    title: "#BE185D",
  },
): Record<string, unknown> {
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

function createdSingleOrderFlex(order: EmailOrder) {
  return bubble(`新訂單｜${orderTypeLabel(order.orderType)}`, order.orderNo, [
    keyValue("客戶", safeText(order.customerName, "未填寫")),
    divider(),
    text("商品", { size: "xs", color: "#BE185D", weight: "bold" }),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("付款方式", paymentMethodLabel(order.paymentMethod)),
  ], { background: "#E8F5E9", title: "#2E7D32" });
}

function createdMixedOrderFlex(orders: EmailOrder[]) {
  const firstOrder = orders[0];
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const orderBlocks = orders.flatMap((order, index) => [
    ...(index > 0 ? [divider()] : []),
    ...orderSection(order),
  ]);

  return bubble("新訂單｜現貨＋預購", safeText(firstOrder?.checkoutGroupId, "mixed checkout"), [
    keyValue("客戶", safeText(firstOrder?.customerName, "未填寫")),
    divider(),
    ...orderBlocks,
    divider(),
    keyValue("合計", formatTwd(total)),
    keyValue("付款方式", paymentMethodLabel(firstOrder?.paymentMethod || "")),
  ], { background: "#E8F5E9", title: "#2E7D32" });
}

function createdFlex(orders: EmailOrder[]) {
  return orders.length > 1 ? createdMixedOrderFlex(orders) : createdSingleOrderFlex(orders[0]);
}

function cancelledFlex(order: EmailOrder) {
  const contents: FlexComponent[] = [
    keyValue("訂單編號", order.orderNo),
    divider(),
    text("商品", { size: "xs", color: "#BE185D", weight: "bold" }),
    ...itemRows(order.items),
    divider(),
    keyValue("金額", formatTwd(order.total)),
    keyValue("付款狀態", paymentStatusLabel(order.paymentStatus)),
    keyValue("取消原因", safeText(order.cancelReason, "未填寫")),
  ];

  if (order.paymentStatus === "paid") {
    contents.push(text("已付款訂單取消，請確認退款處理", {
      size: "xs",
      color: "#B45309",
      weight: "bold",
      margin: "md",
    }));
  }

  return bubble(`訂單已取消｜${orderTypeLabel(order.orderType)}`, order.orderNo, contents);
}

function createdAltText(orders: EmailOrder[]) {
  if (orders.length > 1) {
    return `新訂單｜現貨＋預購｜${orders.map((order) => order.orderNo).join("、")}`;
  }
  return `新訂單｜${orderTypeLabel(orders[0]?.orderType || "")}｜${orders[0]?.orderNo || ""}`;
}

function cancelledAltText(order: EmailOrder) {
  return `訂單已取消｜${orderTypeLabel(order.orderType)}｜${order.orderNo}`;
}

export async function sendOrderCreatedLineNotification(orders: EmailOrder[]) {
  const validOrders = orders.filter((order) => order.orderNo);
  if (!validOrders.length) {
    logLineNotification("line_order_created_skipped", { reason: "missing_orders" });
    return null;
  }

  try {
    return await sendLineAdminFlex(createdAltText(validOrders), createdFlex(validOrders));
  } catch (error) {
    logLineNotification("line_order_created_failed", {
      order_no: validOrders.map((order) => order.orderNo).join(","),
      checkout_group_id: validOrders[0]?.checkoutGroupId || "",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function sendOrderCancelledLineNotification(order: EmailOrder | null) {
  if (!order?.orderNo) {
    logLineNotification("line_order_cancelled_skipped", { reason: "missing_order" });
    return null;
  }

  try {
    return await sendLineAdminFlex(cancelledAltText(order), cancelledFlex(order));
  } catch (error) {
    logLineNotification("line_order_cancelled_failed", {
      order_no: order.orderNo,
      checkout_group_id: order.checkoutGroupId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

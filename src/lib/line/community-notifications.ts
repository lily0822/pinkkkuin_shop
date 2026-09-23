import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendLineUserText } from "./client";
import { getCommunityLineTemplates, renderCommunityLineTemplate } from "./community-notification-templates";

export type CommunityLineNotificationKind = "bought" | "arrived" | "marketplace_ready";
export const COMMUNITY_LINE_NOTIFICATION_KINDS: CommunityLineNotificationKind[] = [
  "bought",
  "arrived",
  "marketplace_ready",
];

/** Kinds sendable from the general 訂單明細 batch notify control. 賣貨便可下單
 * moved to a dedicated per-出貨申請 action (sendCommunityShipmentMarketplaceNotification)
 * so it always uses that shipment request's own marketplace_url — never a
 * manually-typed link. */
export const COMMUNITY_LINE_BATCH_NOTIFICATION_KINDS: CommunityLineNotificationKind[] = ["bought", "arrived"];

export type CommunityLineNotificationResult = {
  orderId: string;
  nickname: string;
  status: "sent" | "failed";
  errorMessage?: string;
};

type ResolvedOrder = { orderId: string; nickname: string; lineUserId: string };

function logCommunityLine(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "line",
      scope: "community",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

async function getApprovedLineUserId(nickname: string): Promise<string> {
  const trimmed = nickname.trim();
  if (!trimmed) return "";
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_line_bindings")
      .select("line_user_id")
      .ilike("nickname", trimmed)
      .eq("review_status", "approved")
      .maybeSingle();
    if (error || !data) return "";
    return typeof data.line_user_id === "string" ? data.line_user_id.trim() : "";
  } catch {
    return "";
  }
}

async function recordNotification(params: {
  kind: CommunityLineNotificationKind;
  targetId: string;
  nickname: string;
  lineUserId: string;
  status: "sent" | "failed";
  errorMessage?: string;
}) {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("community_line_notifications").upsert(
      {
        kind: params.kind,
        target_id: params.targetId,
        nickname: params.nickname,
        line_user_id: params.lineUserId || null,
        status: params.status,
        error_message: params.status === "failed" ? (params.errorMessage || "未知錯誤").slice(0, 500) : null,
        sent_at: params.status === "sent" ? new Date().toISOString() : null,
      },
      { onConflict: "kind,target_id" },
    );
  } catch (error) {
    logCommunityLine("community_line_notification_record_failed", {
      kind: params.kind,
      target_id: params.targetId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function recordGroupResult(
  kind: CommunityLineNotificationKind,
  lineUserId: string,
  orders: ResolvedOrder[],
  status: "sent" | "failed",
  errorMessage?: string,
): Promise<CommunityLineNotificationResult[]> {
  const results: CommunityLineNotificationResult[] = [];
  for (const order of orders) {
    await recordNotification({ kind, targetId: order.orderId, nickname: order.nickname, lineUserId, status, errorMessage });
    results.push({ orderId: order.orderId, nickname: order.nickname, status, errorMessage });
  }
  return results;
}

async function getOrderProductLines(orderId: string, kind: CommunityLineNotificationKind): Promise<string[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data: orderRow } = await supabase
      .from("community_orders")
      .select("notebook_name")
      .eq("id", orderId)
      .maybeSingle();
    const notebookName = orderRow?.notebook_name ? String(orderRow.notebook_name).trim() : "—";

    let itemsQuery = supabase
      .from("community_order_items")
      .select("product_name, quantity, purchase_status, arrival_status")
      .eq("order_id", orderId)
      .eq("purchase_status", "bought");
    if (kind === "arrived") itemsQuery = itemsQuery.eq("arrival_status", "arrived");

    const { data: itemRows } = await itemsQuery;
    return (Array.isArray(itemRows) ? itemRows : []).map((row) => {
      const productName = row.product_name ? String(row.product_name).trim() : "—";
      const quantity = Number(row.quantity || 0) || 1;
      return `${notebookName}｜${productName} ×${quantity}`;
    });
  } catch {
    return [];
  }
}

async function buildProductList(orders: ResolvedOrder[], kind: CommunityLineNotificationKind): Promise<string> {
  const lines: string[] = [];
  for (const order of orders) {
    lines.push(...(await getOrderProductLines(order.orderId, kind)));
  }
  return lines.join("\n");
}

/**
 * Sends exactly one LINE message to this recipient (one API call), then
 * records + returns a result for every order in the group so the caller can
 * still show/track status per selected order even though only one message
 * went out. Never throws — every failure path (push disabled,
 * network/provider error) is caught and recorded as "failed" with a reason
 * instead. Only handles kind='bought'/'arrived' — 賣貨便可下單 has its own
 * dedicated sendCommunityShipmentMarketplaceNotification below.
 */
async function sendToLineUserGroup(
  kind: CommunityLineNotificationKind,
  lineUserId: string,
  orders: ResolvedOrder[],
  template: string,
): Promise<CommunityLineNotificationResult[]> {
  try {
    const productList = await buildProductList(orders, kind);
    const text = renderCommunityLineTemplate(template, { productList });
    const sendResult = await sendLineUserText(lineUserId, text);
    if (sendResult.disabled) {
      return recordGroupResult(kind, lineUserId, orders, "failed", "LINE 推播未設定（缺少 LINE_CHANNEL_ACCESS_TOKEN）");
    }

    logCommunityLine("community_line_notification_sent", {
      kind,
      line_user_id: lineUserId,
      order_ids: orders.map((order) => order.orderId),
      provider_message_id: sendResult.id,
    });
    return recordGroupResult(kind, lineUserId, orders, "sent");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "傳送失敗";
    logCommunityLine("community_line_notification_failed", { kind, line_user_id: lineUserId, message: errorMessage });
    return recordGroupResult(kind, lineUserId, orders, "failed", errorMessage);
  }
}

/**
 * Manual, admin-triggered batch notification. Deduplicates by LINE user id
 * first — if several selected orders belong to the same bound customer,
 * only one LINE message is sent to them, but a result (and a
 * community_line_notifications row) is still recorded for every selected
 * order so the admin can see status per order.
 */
export async function sendCommunityOrderNotifications(
  kind: CommunityLineNotificationKind,
  orders: { orderId: string; nickname: string }[],
): Promise<CommunityLineNotificationResult[]> {
  const templates = await getCommunityLineTemplates();
  const template = templates[kind];

  const unresolved: CommunityLineNotificationResult[] = [];
  const groups = new Map<string, ResolvedOrder[]>();

  for (const order of orders) {
    const lineUserId = await getApprovedLineUserId(order.nickname);
    if (!lineUserId) {
      const errorMessage = "找不到已核准的 LINE 綁定";
      await recordNotification({ kind, targetId: order.orderId, nickname: order.nickname, lineUserId: "", status: "failed", errorMessage });
      unresolved.push({ orderId: order.orderId, nickname: order.nickname, status: "failed", errorMessage });
      continue;
    }
    const group = groups.get(lineUserId) || [];
    group.push({ orderId: order.orderId, nickname: order.nickname, lineUserId });
    groups.set(lineUserId, group);
  }

  const results: CommunityLineNotificationResult[] = [...unresolved];
  for (const [lineUserId, groupOrders] of groups) {
    results.push(...(await sendToLineUserGroup(kind, lineUserId, groupOrders, template)));
  }
  return results;
}

/**
 * 賣貨便可下單, triggered from one specific 出貨申請 row (never from the
 * general order-selection batch flow). Everything — buyer, shipped items,
 * and the marketplace link — comes straight from that shipment request row;
 * the admin never types a link in. Recorded under kind='marketplace_ready'
 * with target_id = the shipment request id (this trigger is scoped to one
 * shipment request, not one order), reusing the same
 * community_line_notifications table, the same approved-binding lookup, and
 * the same saved template as the general flow.
 */
export async function sendCommunityShipmentMarketplaceNotification(
  shipmentRequestId: string,
): Promise<CommunityLineNotificationResult> {
  const kind: CommunityLineNotificationKind = "marketplace_ready";
  let nickname = "";
  try {
    const supabase = createSupabaseServiceClient();
    const { data: request, error } = await supabase
      .from("community_shipment_requests")
      .select("nickname, order_ids, marketplace_url")
      .eq("id", shipmentRequestId)
      .maybeSingle();
    if (error) throw error;
    if (!request) {
      const errorMessage = "找不到這筆出貨申請";
      await recordNotification({ kind, targetId: shipmentRequestId, nickname: "", lineUserId: "", status: "failed", errorMessage });
      return { orderId: shipmentRequestId, nickname: "", status: "failed", errorMessage };
    }

    nickname = String(request.nickname || "");
    const marketplaceUrl = String(request.marketplace_url || "").trim();
    const orderIds = (Array.isArray(request.order_ids) ? request.order_ids : []).map(String).filter(Boolean);

    if (!marketplaceUrl) {
      const errorMessage = "這筆出貨申請尚未建立賣貨便連結";
      await recordNotification({ kind, targetId: shipmentRequestId, nickname, lineUserId: "", status: "failed", errorMessage });
      return { orderId: shipmentRequestId, nickname, status: "failed", errorMessage };
    }

    const lineUserId = await getApprovedLineUserId(nickname);
    if (!lineUserId) {
      const errorMessage = "找不到已核准的 LINE 綁定";
      await recordNotification({ kind, targetId: shipmentRequestId, nickname, lineUserId: "", status: "failed", errorMessage });
      return { orderId: shipmentRequestId, nickname, status: "failed", errorMessage };
    }

    const templates = await getCommunityLineTemplates();
    const productList = (await Promise.all(orderIds.map((orderId) => getOrderProductLines(orderId, kind))))
      .flat()
      .join("\n");
    const text = renderCommunityLineTemplate(templates[kind], { productList, marketplaceUrl });

    const sendResult = await sendLineUserText(lineUserId, text);
    if (sendResult.disabled) {
      const errorMessage = "LINE 推播未設定（缺少 LINE_CHANNEL_ACCESS_TOKEN）";
      await recordNotification({ kind, targetId: shipmentRequestId, nickname, lineUserId, status: "failed", errorMessage });
      return { orderId: shipmentRequestId, nickname, status: "failed", errorMessage };
    }

    await recordNotification({ kind, targetId: shipmentRequestId, nickname, lineUserId, status: "sent" });
    logCommunityLine("community_line_notification_sent", {
      kind,
      line_user_id: lineUserId,
      shipment_request_id: shipmentRequestId,
      provider_message_id: sendResult.id,
    });
    return { orderId: shipmentRequestId, nickname, status: "sent" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "傳送失敗";
    logCommunityLine("community_line_notification_failed", { kind, shipment_request_id: shipmentRequestId, message: errorMessage });
    await recordNotification({ kind, targetId: shipmentRequestId, nickname, lineUserId: "", status: "failed", errorMessage });
    return { orderId: shipmentRequestId, nickname, status: "failed", errorMessage };
  }
}

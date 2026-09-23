import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendLineUserText } from "./client";

export type CommunityLineNotificationKind = "bought" | "arrived" | "marketplace_ready";
export const COMMUNITY_LINE_NOTIFICATION_KINDS: CommunityLineNotificationKind[] = [
  "bought",
  "arrived",
  "marketplace_ready",
];

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

async function findMarketplaceUrlForOrder(orderId: string): Promise<string> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_shipment_requests")
      .select("marketplace_url, submitted_at")
      .contains("order_ids", [orderId])
      .not("marketplace_url", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return "";
    return typeof data.marketplace_url === "string" ? data.marketplace_url.trim() : "";
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

function messageForKind(kind: CommunityLineNotificationKind, marketplaceUrl: string) {
  if (kind === "bought") {
    return "【小企鵝選物】提醒您完成匯款喔！請前往社群訂單頁面查看付款資訊 ♡";
  }
  if (kind === "arrived") {
    return "【小企鵝選物】您訂購的商品已到貨！請回社群訂單頁面選擇這次要一起出貨或面交的系列 ♡";
  }
  return `【小企鵝選物】您的賣貨便連結已建立完成，請點擊以下連結下單：\n${marketplaceUrl}`;
}

/**
 * Sends exactly one LINE message to this recipient (one API call), then
 * records + returns a result for every order in the group so the caller can
 * still show/track status per selected order even though only one message
 * went out. Never throws — every failure path (no marketplace link, push
 * disabled, network/provider error) is caught and recorded as "failed" with
 * a reason instead.
 */
async function sendToLineUserGroup(
  kind: CommunityLineNotificationKind,
  lineUserId: string,
  orders: ResolvedOrder[],
): Promise<CommunityLineNotificationResult[]> {
  try {
    let marketplaceUrl = "";
    if (kind === "marketplace_ready") {
      for (const order of orders) {
        marketplaceUrl = await findMarketplaceUrlForOrder(order.orderId);
        if (marketplaceUrl) break;
      }
      if (!marketplaceUrl) {
        return recordGroupResult(kind, lineUserId, orders, "failed", "找不到這些訂單的賣貨便連結");
      }
    }

    const sendResult = await sendLineUserText(lineUserId, messageForKind(kind, marketplaceUrl));
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
    results.push(...(await sendToLineUserGroup(kind, lineUserId, groupOrders)));
  }
  return results;
}

import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendLineUserText } from "./client";

export type CommunityLineNotificationKind = "bought" | "arrived" | "marketplace_ready";

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

async function sendCommunityNotification(
  kind: CommunityLineNotificationKind,
  targetId: string,
  nickname: string,
  text: string,
) {
  try {
    const lineUserId = await getApprovedLineUserId(nickname);
    if (!lineUserId) {
      await recordNotification({ kind, targetId, nickname, lineUserId: "", status: "failed", errorMessage: "找不到已核准的 LINE 綁定" });
      logCommunityLine("community_line_notification_skipped", { kind, target_id: targetId, reason: "not_linked" });
      return;
    }
    const result = await sendLineUserText(lineUserId, text);
    if (result.disabled) {
      await recordNotification({ kind, targetId, nickname, lineUserId, status: "failed", errorMessage: "LINE 推播未設定（缺少 LINE_CHANNEL_ACCESS_TOKEN）" });
      logCommunityLine("community_line_notification_skipped", { kind, target_id: targetId, reason: "push_disabled" });
      return;
    }
    await recordNotification({ kind, targetId, nickname, lineUserId, status: "sent" });
    logCommunityLine("community_line_notification_sent", { kind, target_id: targetId, provider_message_id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "傳送失敗";
    logCommunityLine("community_line_notification_failed", { kind, target_id: targetId, message });
    await recordNotification({ kind, targetId, nickname, lineUserId: "", status: "failed", errorMessage: message });
  }
}

/** 有買到 → 通知客人付款 */
export async function notifyCommunityBought(itemId: string, nickname: string, productName: string) {
  const text = `【小企鵝選物】${productName || "您訂購的商品"} 已確認搶購成功！\n記得完成匯款喔，請前往社群訂單頁面查看付款資訊 ♡`;
  await sendCommunityNotification("bought", itemId, nickname, text);
}

/** 商品到貨 → 通知客人回前台選擇這次要一起出貨／面交的系列（依記事本通知所有相關客人） */
export async function notifyCommunityNotebookArrived(notebookName: string) {
  const name = notebookName.trim();
  if (!name) return;
  try {
    const supabase = createSupabaseServiceClient();
    const { data: orders, error: ordersError } = await supabase
      .from("community_orders")
      .select("id, nickname")
      .eq("notebook_name", name);
    if (ordersError || !Array.isArray(orders) || !orders.length) return;

    const orderIds = orders.map((order) => String(order.id || "")).filter(Boolean);
    if (!orderIds.length) return;

    const { data: items, error: itemsError } = await supabase
      .from("community_order_items")
      .select("order_id")
      .in("order_id", orderIds)
      .eq("purchase_status", "bought")
      .eq("arrival_status", "arrived");
    if (itemsError || !Array.isArray(items)) return;

    const notifyOrderIds = new Set(items.map((item) => String(item.order_id || "")));
    const text = `【小企鵝選物】「${name}」的商品已到貨！\n請回社群訂單頁面選擇這次要一起出貨或面交的系列 ♡`;
    for (const order of orders) {
      const orderId = String(order.id || "");
      const nickname = String(order.nickname || "");
      if (!orderId || !nickname || !notifyOrderIds.has(orderId)) continue;
      await sendCommunityNotification("arrived", orderId, nickname, text);
    }
  } catch (error) {
    logCommunityLine("community_line_notification_notebook_arrived_failed", {
      notebook_name: name,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** 賣貨便連結建立完成 → 通知客人可以下單，訊息附賣貨便連結 */
export async function notifyCommunityMarketplaceReady(shipmentRequestId: string, nickname: string, marketplaceUrl: string) {
  const url = marketplaceUrl.trim();
  if (!url) return;
  const text = `【小企鵝選物】您的賣貨便連結已建立完成，請點擊以下連結下單：\n${url}`;
  await sendCommunityNotification("marketplace_ready", shipmentRequestId, nickname, text);
}

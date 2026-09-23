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
 * Manual, admin-triggered batch notification for one order. Never throws —
 * every failure path (no marketplace link, no approved binding, LINE push
 * disabled, network/provider error) is caught, recorded to
 * community_line_notifications, and returned as a per-order result so the
 * caller can show success/fail counts without the request ever failing.
 */
export async function sendCommunityOrderNotification(
  kind: CommunityLineNotificationKind,
  orderId: string,
  nickname: string,
): Promise<CommunityLineNotificationResult> {
  try {
    let marketplaceUrl = "";
    if (kind === "marketplace_ready") {
      marketplaceUrl = await findMarketplaceUrlForOrder(orderId);
      if (!marketplaceUrl) {
        const errorMessage = "找不到這筆訂單的賣貨便連結";
        await recordNotification({ kind, targetId: orderId, nickname, lineUserId: "", status: "failed", errorMessage });
        return { orderId, nickname, status: "failed", errorMessage };
      }
    }

    const lineUserId = await getApprovedLineUserId(nickname);
    if (!lineUserId) {
      const errorMessage = "找不到已核准的 LINE 綁定";
      await recordNotification({ kind, targetId: orderId, nickname, lineUserId: "", status: "failed", errorMessage });
      return { orderId, nickname, status: "failed", errorMessage };
    }

    const result = await sendLineUserText(lineUserId, messageForKind(kind, marketplaceUrl));
    if (result.disabled) {
      const errorMessage = "LINE 推播未設定（缺少 LINE_CHANNEL_ACCESS_TOKEN）";
      await recordNotification({ kind, targetId: orderId, nickname, lineUserId, status: "failed", errorMessage });
      return { orderId, nickname, status: "failed", errorMessage };
    }

    await recordNotification({ kind, targetId: orderId, nickname, lineUserId, status: "sent" });
    logCommunityLine("community_line_notification_sent", { kind, target_id: orderId, provider_message_id: result.id });
    return { orderId, nickname, status: "sent" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "傳送失敗";
    logCommunityLine("community_line_notification_failed", { kind, target_id: orderId, message: errorMessage });
    await recordNotification({ kind, targetId: orderId, nickname, lineUserId: "", status: "failed", errorMessage });
    return { orderId, nickname, status: "failed", errorMessage };
  }
}

export async function sendCommunityOrderNotifications(
  kind: CommunityLineNotificationKind,
  orders: { orderId: string; nickname: string }[],
): Promise<CommunityLineNotificationResult[]> {
  const results: CommunityLineNotificationResult[] = [];
  for (const order of orders) {
    results.push(await sendCommunityOrderNotification(kind, order.orderId, order.nickname));
  }
  return results;
}

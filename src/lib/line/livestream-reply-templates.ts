import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 客人實際會看到的「主要流程」回覆文案改成後台可編輯，比照
// community-notification-templates.ts 的 schedule_settings KV 模式（不開
// 新表、不做新機制）。範圍只涵蓋客人正常操作會走到的訊息；系統內部的
// 錯誤/邊界文案（圖片下載失敗、查詢訂單失敗等）維持寫死在
// livestream-orders.ts 裡，不開放編輯——這些是異常分支，不是客人會
// 一路正常走到的文案，改壞了也沒有「用預設文案」以外的補救路徑。
const SETTINGS_TYPE = "community-livestream-reply-templates";
const MAX_TEMPLATE_LENGTH = 2000;

export type LivestreamReplyTemplateKey =
  | "order_welcome"
  | "cancel_empty"
  | "cancel_intro_all"
  | "cancel_intro_partial"
  | "cancel_blocked_bought"
  | "cancel_blocked_paying"
  | "cancel_success"
  | "remittance_empty"
  | "remittance_summary"
  | "remittance_format_invalid"
  | "remittance_success"
  | "photo_confirm_success"
  | "photo_confirm_empty";

export const LIVESTREAM_REPLY_TEMPLATE_KEYS: LivestreamReplyTemplateKey[] = [
  "order_welcome",
  "cancel_empty",
  "cancel_intro_all",
  "cancel_intro_partial",
  "cancel_blocked_bought",
  "cancel_blocked_paying",
  "cancel_success",
  "remittance_empty",
  "remittance_summary",
  "remittance_format_invalid",
  "remittance_success",
  "photo_confirm_success",
  "photo_confirm_empty",
];

export type LivestreamReplyTemplates = Record<LivestreamReplyTemplateKey, string>;

// 逐字跟改動前的寫死文案一致——即使從未進過後台設定畫面，bot 的回覆內容
// 也跟改動前完全一樣，不會突然改變。
export const DEFAULT_LIVESTREAM_REPLY_TEMPLATES: LivestreamReplyTemplates = {
  order_welcome:
    "已開啟下單功能，請直接上傳您要的商品圖片即可，不需要再輸入其他文字！提醒您：若超過 10 分鐘沒有上傳新照片，請重新輸入「我要下單」繼續使用。",
  cancel_empty: "目前沒有可以取消的商品喔（已購買或已在匯款流程中的商品無法取消）。",
  cancel_intro_all: "以下是您目前可以取消的商品：",
  cancel_intro_partial: "您已購買或已在匯款流程中的 {{數量}} 項商品不會列在這裡，恕無法取消。以下是可以取消的商品：",
  cancel_blocked_bought: "這項商品已經購買，無法取消。",
  cancel_blocked_paying: "這項商品已在匯款流程中，無法取消。",
  cancel_success: "已為您取消「{{商品名稱}}」，感謝您的訂購！",
  remittance_empty: "目前沒有待匯款的訂單喔。",
  remittance_summary:
    "以上是您目前下單的所有商品，請自行計算總金額，完成匯款後請依照以下格式回覆：\n1.匯到哪家銀行：\n2.金額：\n3.末五碼：",
  remittance_format_invalid:
    "格式有誤或漏填，請依照以下格式重新回覆（三項都要填）：\n1.匯到哪家銀行：\n2.金額：\n3.末五碼：",
  remittance_success: "已收到您的匯款回報，我們將盡快為您核對，感謝您！",
  photo_confirm_success: "已錄入商品，感謝您的訂購！",
  photo_confirm_empty: "目前沒有收到您的商品照片喔，請先上傳圖片再回覆「傳好了」。",
};

function sanitizeTemplates(input: Partial<Record<LivestreamReplyTemplateKey, unknown>>): LivestreamReplyTemplates {
  const result = {} as LivestreamReplyTemplates;
  LIVESTREAM_REPLY_TEMPLATE_KEYS.forEach((key) => {
    const value = input[key];
    result[key] =
      typeof value === "string" && value.trim() ? value.slice(0, MAX_TEMPLATE_LENGTH) : DEFAULT_LIVESTREAM_REPLY_TEMPLATES[key];
  });
  return result;
}

export async function getLivestreamReplyTemplates(): Promise<LivestreamReplyTemplates> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return { ...DEFAULT_LIVESTREAM_REPLY_TEMPLATES };
    return sanitizeTemplates(JSON.parse(data.image));
  } catch {
    return { ...DEFAULT_LIVESTREAM_REPLY_TEMPLATES };
  }
}

export async function saveLivestreamReplyTemplate(
  key: LivestreamReplyTemplateKey,
  text: string,
): Promise<LivestreamReplyTemplates> {
  const current = await getLivestreamReplyTemplates();
  const next = sanitizeTemplates({ ...current, [key]: text });
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(next) }, { onConflict: "type" });
  if (error) throw error;
  return next;
}

export function renderLivestreamReplyTemplate(template: string, vars: Record<string, string> = {}): string {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    result = result.replaceAll(`{{${key}}}`, value);
  });
  return result;
}

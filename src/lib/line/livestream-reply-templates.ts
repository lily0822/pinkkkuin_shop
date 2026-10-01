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
  | "nickname_ask"
  | "nickname_submitted"
  | "nickname_taken"
  | "nickname_pending"
  | "not_bound_yet"
  | "order_welcome"
  | "photo_over_cap"
  | "done_intro"
  | "done_empty"
  | "quantity_updated"
  | "quantity_ask_number"
  | "quantity_invalid_number"
  | "quantity_locked"
  | "quantity_confirmed"
  | "quantity_confirm_empty"
  | "cancel_empty"
  | "cancel_intro_all"
  | "cancel_intro_partial"
  | "cancel_blocked_bought"
  | "cancel_blocked_paying"
  | "cancel_success"
  | "remittance_empty"
  | "remittance_unresolved"
  | "remittance_summary"
  | "remittance_success"
  | "price_dispute_ask_amount"
  | "price_dispute_invalid_amount"
  | "price_dispute_received";

export const LIVESTREAM_REPLY_TEMPLATE_KEYS: LivestreamReplyTemplateKey[] = [
  "nickname_ask",
  "nickname_submitted",
  "nickname_taken",
  "nickname_pending",
  "not_bound_yet",
  "order_welcome",
  "photo_over_cap",
  "done_intro",
  "done_empty",
  "quantity_updated",
  "quantity_ask_number",
  "quantity_invalid_number",
  "quantity_locked",
  "quantity_confirmed",
  "quantity_confirm_empty",
  "cancel_empty",
  "cancel_intro_all",
  "cancel_intro_partial",
  "cancel_blocked_bought",
  "cancel_blocked_paying",
  "cancel_success",
  "remittance_empty",
  "remittance_unresolved",
  "remittance_summary",
  "remittance_success",
  "price_dispute_ask_amount",
  "price_dispute_invalid_amount",
  "price_dispute_received",
];

export type LivestreamReplyTemplates = Record<LivestreamReplyTemplateKey, string>;

// 逐字跟改動前的寫死文案一致——即使從未進過後台設定畫面，bot 的回覆內容
// 也跟改動前完全一樣，不會突然改變。
export const DEFAULT_LIVESTREAM_REPLY_TEMPLATES: LivestreamReplyTemplates = {
  nickname_ask: "請輸入您的社群暱稱，審核通過後就能使用下單功能囉！",
  nickname_submitted:
    "已收到您的申請暱稱「{{暱稱}}」，審核通過後即可使用下單功能，請耐心等候！如需修改暱稱請輸入「修改暱稱」。",
  nickname_taken: "暱稱「{{暱稱}}」已經被其他人綁定了，請換一個暱稱再傳一次。",
  nickname_pending: "您申請的暱稱「{{暱稱}}」正在審核中，審核通過後才能使用下單功能，請耐心等候。",
  not_bound_yet: "請先完成社群暱稱綁定並通過審核後，才能使用{{功能名稱}}功能喔。",
  order_welcome:
    "已開啟下單功能，請上傳您要的商品圖片（單次最多 10 張），傳完後請回覆「好了」，我就會列出所有收到的商品讓您填寫數量！",
  photo_over_cap: "這輪已收到 10 張，請先回覆「好了」，我先幫您整理目前收到的商品！",
  done_intro: "已登錄您的商品，請確認以下數量，如果都沒問題請回覆「數量正確」：",
  done_empty: "目前沒有待確認的商品圖片喔，請先上傳圖片再回覆「好了」。",
  quantity_updated: "已將「{{商品名稱}}」數量更新為 {{數量}} 件。",
  quantity_ask_number: "請直接輸入您要的數量（例如：6）。",
  quantity_invalid_number: "請輸入一個大於 0 的數字（例如：6）。",
  quantity_locked: "此訂單數量已確認，如需修改請聯繫客服。",
  quantity_confirmed: "以上已經記錄囉！",
  quantity_confirm_empty: "目前沒有待確認的商品數量喔。",
  cancel_empty: "目前沒有可以取消的商品喔（已購買或已在匯款流程中的商品無法取消）。",
  cancel_intro_all: "以下是您目前可以取消的商品：",
  cancel_intro_partial: "您已購買或已在匯款流程中的 {{數量}} 項商品不會列在這裡，恕無法取消。以下是可以取消的商品：",
  cancel_blocked_bought: "這項商品已經購買，無法取消。",
  cancel_blocked_paying: "這項商品已在匯款流程中，無法取消。",
  cancel_success: "已為您取消「{{商品名稱}}」，感謝您的訂購！",
  remittance_empty: "目前沒有待匯款的訂單喔。",
  remittance_unresolved: "您有 {{數量}} 項商品尚未確認金額，請等候客服確認金額後才能匯款，確認後可以再次輸入「我要匯款」。",
  remittance_summary: "應付總額：NT${{總額}}\n\n收款資訊：\n{{收款資訊}}\n\n請回覆您的匯款帳號後 5 碼完成申報（例如：12345）。",
  remittance_success: "已收到您的匯款回報，我們將盡快為您核對，感謝您！",
  price_dispute_ask_amount: "請輸入您看到的正確金額（純數字）。",
  price_dispute_invalid_amount: "請輸入正確的金額（純數字，例如：300）。",
  price_dispute_received: "已收到您回報的金額，我們會盡快確認，謝謝！",
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

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
  | "order_no_session"
  | "order_welcome"
  | "order_photo_first"
  | "order_photo_confirm_card"
  | "order_idle_closed"
  | "order_session_ended"
  | "remittance_choose_kind"
  | "remittance_preorder_unavailable"
  | "remittance_empty"
  | "remittance_all_shortage"
  | "remittance_items_intro"
  | "remittance_shortage_note"
  | "remittance_transfer_instruction"
  | "remittance_confirm_amount_question"
  | "remittance_ask_custom_amount"
  | "remittance_custom_amount_invalid"
  | "remittance_custom_amount_too_large"
  | "remittance_ask_last5"
  | "remittance_last5_invalid"
  | "remittance_cancelled"
  | "remittance_done"
  | "photo_confirm_empty"
  | "order_query_empty"
  | "order_manage_card"
  | "bind_card_title"
  | "bind_card_body_unbound"
  | "bind_card_body_bound"
  | "bind_button_bind"
  | "bind_button_edit"
  | "order_requires_bind_title"
  | "order_requires_bind_body";

export const LIVESTREAM_REPLY_TEMPLATE_KEYS: LivestreamReplyTemplateKey[] = [
  "order_no_session",
  "order_welcome",
  "order_photo_first",
  "order_photo_confirm_card",
  "order_idle_closed",
  "order_session_ended",
  "remittance_choose_kind",
  "remittance_preorder_unavailable",
  "remittance_empty",
  "remittance_all_shortage",
  "remittance_items_intro",
  "remittance_shortage_note",
  "remittance_transfer_instruction",
  "remittance_confirm_amount_question",
  "remittance_ask_custom_amount",
  "remittance_custom_amount_invalid",
  "remittance_custom_amount_too_large",
  "remittance_ask_last5",
  "remittance_last5_invalid",
  "remittance_cancelled",
  "remittance_done",
  "photo_confirm_empty",
  "order_query_empty",
  "order_manage_card",
  "bind_card_title",
  "bind_card_body_unbound",
  "bind_card_body_bound",
  "bind_button_bind",
  "bind_button_edit",
  "order_requires_bind_title",
  "order_requires_bind_body",
];

export type LivestreamReplyTemplates = Record<LivestreamReplyTemplateKey, string>;

// 逐字跟改動前的寫死文案一致——即使從未進過後台設定畫面，bot 的回覆內容
// 也跟改動前完全一樣，不會突然改變。
export const DEFAULT_LIVESTREAM_REPLY_TEMPLATES: LivestreamReplyTemplates = {
  order_no_session: "目前沒有進行中的連線，連線時間再來下單喔！",
  order_welcome: "開始下單囉！請把想買的商品照片傳給我，傳完請按「傳好了」。（10 分鐘沒有動作會自動關閉）",
  order_photo_first: "收到囉！可以繼續傳，傳完請按「傳好了」。",
  order_photo_confirm_card: "請確認後點下方按鈕填寫數量與單價。",
  order_idle_closed:
    "超過 10 分鐘沒有動作，下單功能已自動關閉。已傳的 {{數量}} 張照片還保留著，按「傳好了」可以確認數量後送出；要繼續傳照片，請重新按「我要下單」。",
  order_session_ended: "這場連線已經結束了。沒有送出的 {{數量}} 張照片已清除。下次連線開始時再按「我要下單」就可以囉。",
  remittance_choose_kind: "請選擇要匯款的類型：",
  remittance_preorder_unavailable: "預購匯款功能尚未開放，請直接聯繫賣家協助處理，謝謝。",
  remittance_empty: "目前沒有待匯款的訂單喔。",
  remittance_all_shortage: "您目前的 {{數量}} 項商品都缺貨，不用匯款喔。",
  remittance_items_intro: "以上是這次要匯款的商品，總金額 NT${{金額}}。請選擇要用哪家銀行匯款：",
  remittance_shortage_note: "\n另外有 {{數量}} 樣缺貨，不用匯款。",
  remittance_transfer_instruction: "請使用上方帳號完成轉帳，轉帳完成後請按下方按鈕繼續。",
  remittance_confirm_amount_question: "應匯金額 NT${{金額}}，您匯的金額是這個嗎？",
  remittance_ask_custom_amount: "請輸入您實際匯款的金額（請輸入正整數數字）：",
  remittance_custom_amount_invalid: "金額格式錯誤，請輸入正整數數字（例如：1250）。",
  remittance_custom_amount_too_large: "金額太大了，請確認後重新輸入。",
  remittance_ask_last5: "請完成轉帳後，輸入轉帳帳號的末五碼：",
  remittance_last5_invalid: "末五碼需為 5 碼數字，請重新輸入。如需取消匯款請輸入「取消匯款」。",
  remittance_cancelled: "已取消匯款申報，如需使用請重新輸入「我要匯款」。",
  remittance_done: "已收到您的匯款資訊（總金額 NT${{金額}}），我們將盡快為您核對，感謝您！",
  photo_confirm_empty: "還沒收到照片喔，請先按「我要下單」再傳商品照片。",
  order_query_empty: "目前沒有查到您的下單紀錄喔。",
  order_manage_card: "點下方按鈕查看與管理您目前的訂單。",
  bind_card_title: "綁定社群帳號",
  bind_card_body_unbound: "讓賣家知道你是社群裡的誰，只要填一次。",
  bind_card_body_bound: "你目前綁定的是「{{值}}」。",
  bind_button_bind: "綁定",
  bind_button_edit: "修改",
  order_requires_bind_title: "先綁定一下社群帳號",
  order_requires_bind_body: "第一次下單前，請先讓賣家知道你是社群裡的誰，只要填一次。",
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

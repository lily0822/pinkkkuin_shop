import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteOrigin } from "@/lib/supabase/config";
import { createSignedUrl, deletePrivateFiles, uploadPrivateFile } from "@/lib/supabase/storage";
import {
  downloadLineMessageContent,
  getLineUserProfile,
  sendLineReply,
  sendLineReplyText,
  type LineQuickReply,
  type LineReplyMessage,
} from "./client";
import {
  getLivestreamBankAccounts,
  LIVESTREAM_BANK_ACCOUNT_KEYS,
  LIVESTREAM_BANK_ACCOUNT_LABELS,
  type LivestreamBankAccounts,
} from "./livestream-bank-info";
import { normalizeLivestreamBankName } from "./livestream-bank-aliases";
import {
  getLivestreamKeywordSettings,
  type LivestreamKeywordEnabled,
  type LivestreamKeywordGroup,
  type LivestreamKeywords,
} from "./livestream-keywords";
import {
  getLivestreamReplyTemplates,
  renderLivestreamReplyTemplate,
  type LivestreamReplyTemplateKey,
  type LivestreamReplyTemplates,
} from "./livestream-reply-templates";
import { getCurrentSession } from "./livestream-sessions";
import { createLivestreamMagicLink } from "./livestream-magic-link";

// 功能一 (下單觸發) + 功能二 (LINE 圖片下單對話流程). 社群暱稱綁定/審核機制
// 已移除——真正區分客人身份的是 line_user_id 本身，nickname 欄位直接拿
// getLineUserProfile() 當下的 LINE 顯示名稱寫入，完全不讀寫
// community_line_bindings（那張表是另一套舊的記事本/社群訂單系統在用，
// 跟這裡無關，見 getLineDisplayName()）。這裡只碰全新獨立的
// community_livestream_orders / community_line_bot_states 兩張表，從不
// 寫入 community_orders/community_order_items。
//
// Every reply in this file MUST go through sendLineReply/sendLineReplyText
// (uses the incoming event's replyToken — free, doesn't count against the
// LINE OA's monthly push quota). Never sendLineUserText/sendLineUserFlex
// here — this entire feature is reply-only now (the one push it used to
// have, on order confirmation, was removed by request — see AI_HANDOFF.md).
//
// 連線代購下單改版 第一階段（目前狀態，取代之前所有版本的說明）：
// 自動辨識（vision.ts/price-ocr.ts，Anthropic 視覺辨識 + tesseract.js
// OCR 備援）整個移除，不再猜商品名稱/價格——客人在 LINE 對話裡「傳
// 照片」階段只是暫存（community_livestream_orders.order_status=
// 'staged'，product_name/unit_price 都是 null），真正的數量/單價是
// 客人自己在免登入網頁（/live/confirm，簽章連結見
// livestream-magic-link.ts）填完「送出訂單」才算數
// （submit_livestream_order RPC，202610270005 migration），商品編號
// 也是送出當下才配（見該 RPC 裡呼叫 increment_livestream_product_
// number）。下單現在需要先有「連線場次」（community_livestream_
// sessions）進行中才能開始，而且有「下單模式」
// （community_line_bot_states.order_mode）跟「閒置 10 分鐘／場次
// 結束」的惰性判斷（見 resolveOrderingGate），兩者都不寫排程、不主動
// 推播，只在客人下一次傳文字/圖片時才檢查。
//
// 「查詢訂單」「取消訂單」「我要匯款」三個功能這一階段維持改版前的
// 行為不變（只補了 order_status='submitted' 的過濾，避免暫存中的
// staged 照片意外出現在這三個功能的清單裡）——這三個會在第二、三階段
// 整個重寫，見 AI_HANDOFF.md。取消訂單清單維持純展示（只有照片＋商品
// 名稱）。匯款時系統不計算金額，客人回報時依固定格式回報「銀行/金額/
// 末五碼」三項，amount 欄位存的是客人自報的金額，純供管理員核對用，
// 不是系統算出來的（金額自動比對是第三階段的範圍）。客人想看目前訂單
// 要自己另外輸入「查詢訂單」——這是獨立功能（見功能七
// handleOrderQueryTrigger），不篩選任何狀態、列出全部商品，跟「取消
// 訂單」是兩個完全不同的功能。
// 「圖片+商品名稱」清單項目共用函式 buildPhotoNameItemBlock 目前被
// 「我要匯款」（handleRemittanceTrigger）跟「查詢訂單」
// （handleOrderQueryTrigger）共用；「取消訂單」改用自己的
// buildCancelItemBlock（多一顆取消按鈕，見功能六）。
//
// awaiting_remittance_last5 等待狀態不再是「獨佔」文字輸入的黑洞：
// handleTextMessage 進入這個狀態後，會先比對 order/remittance/cancel/
// order_query/photo_confirm 任一組已知關鍵字，符合就自動清掉等待狀態、
// 照常執行該指令；另外新增 remittance_cancel（預設「取消匯款」）明確
// 逃生指令，客人隨時可以直接退出。都是為了避免客人不小心碰到「我要
// 匯款」後卡在格式提醒裡出不來。

export type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { id?: string; type?: string; text?: string };
  postback?: { data?: string };
};

export const PHOTO_BUCKET = "community-livestream-photos";
const MAX_PHOTOS_PER_ROUND = 10;
const CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — long enough for LINE to fetch/cache the bubble image
const MAX_REPLY_MESSAGES = 5; // LINE reply API hard limit
// 「下單模式」閒置逾時——跟 order_welcome/order_idle_closed 文案裡的
// 「10 分鐘」是同一個時間概念，改了這個數值記得文案（後台可編輯）也要
// 一併改，不然文字跟實際行為會對不上。
const IDLE_TIMEOUT_MINUTES = 10;

// 六組觸發關鍵字（下單/匯款/取消/查詢訂單/傳照片確認/取消匯款）改成
// 後台可設定——實際的預設值/讀取/fallback 邏輯都在
// src/lib/line/livestream-keywords.ts，這裡不再寫死陣列，一律透過
// getLivestreamKeywordSettings() 在 handleTextMessage 裡每則訊息抓一次
// （讀取失敗會自動 fallback 回預設值，不會直接失效）。每組現在還多了
// 一顆「啟用/停用」開關，一起在同一次呼叫裡拿到，見 matchesEnabledGroup。

function normalizeText(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function matchesAny(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

// 每組關鍵字現在多了「啟用/停用」開關（見 livestream-keywords.ts）——
// 停用的組一律當作沒匹配到，不是跳過檢查而是直接回傳 false，所以
// handleTextMessage 裡原本每一處 matchesAny(text, keywords.X) 都換成
// 呼叫這支，統一先查 enabled[group] 再真的比對關鍵字。
function matchesEnabledGroup(
  text: string,
  keywords: LivestreamKeywords,
  enabled: LivestreamKeywordEnabled,
  group: LivestreamKeywordGroup,
) {
  if (!enabled[group]) return false;
  return matchesAny(text, keywords[group]);
}

// 匯款回報改成固定三項格式（銀行／金額／末五碼），客人自行計算總金額
// 後依格式回覆——用寬鬆比對解析，不要求逐字照格式打：逐行找出含有
// 「銀行」「金額」「末五碼」關鍵字的那一行，取冒號（全/半形皆可）後面
// 的內容當作該欄位的值，不管客人有沒有打數字編號、行順序對不對。
type RemittanceReport = { bankName: string; amount: number; last5: string };

function extractReportFieldValue(lines: string[], keyword: string): string | null {
  for (const line of lines) {
    if (!line.includes(keyword)) continue;
    const colonIndex = line.search(/[:：]/);
    if (colonIndex === -1) continue;
    const value = line.slice(colonIndex + 1).trim();
    if (value) return value;
  }
  return null;
}

function parseRemittanceReport(rawText: string): RemittanceReport | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bankNameRaw = extractReportFieldValue(lines, "銀行");
  if (!bankNameRaw) return null;
  // 客人打的銀行名稱先查別名表正規化成標準名稱（中信/富邦/國泰）——
  // 對照不到的名稱原文照存，後台「匯款紀錄」頁籤會把它標成「異常」，
  // 不會因為查無此名就擋下整筆申報（見 livestream-bank-aliases.ts）。
  const bankName = normalizeLivestreamBankName(bankNameRaw.slice(0, 50));

  const amountRaw = extractReportFieldValue(lines, "金額");
  if (!amountRaw) return null;
  const amountMatch = amountRaw.replace(/,/g, "").match(/\d+/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[0]);
  if (!(amount > 0)) return null;

  const last5Raw = extractReportFieldValue(lines, "末五碼");
  if (!last5Raw) return null;
  const last5Digits = last5Raw.replace(/\D/g, "");
  if (!/^\d{5}$/.test(last5Digits)) return null;

  return { bankName, amount, last5: last5Digits };
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function reply(replyToken: string | undefined, text: string) {
  if (!replyToken) return;
  await sendLineReplyText(replyToken, text);
}

// 13 則客人會實際看到的「主要流程」文案改成後台可編輯（見
// livestream-reply-templates.ts）；系統內部的錯誤/邊界文案不在這套機制
// 裡，繼續直接呼叫上面的 reply() 寫死文字。templates 一律由呼叫鏈最上層
// （handleTextMessage/handleImageMessage/handlePostback，三個 handleLineEvent
// 會分派到的入口）各自查一次、往下傳，不在每個訊息各自查一次資料庫。
async function replyTemplate(
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
  key: LivestreamReplyTemplateKey,
  vars?: Record<string, string>,
) {
  await reply(replyToken, renderLivestreamReplyTemplate(templates[key], vars));
}

export type SupabaseService = ReturnType<typeof createSupabaseServiceClient>;

// Shared by the backend's DELETE /api/backend/community/livestream-orders/[id]
// route (admin-initiated delete) and 功能六's LINE self-cancel flow below —
// one hard delete, no separate "safe delete" RPC (this table is a brand-new,
// simple, fully independent design, unlike the older community_orders/
// community_order_items safe-delete path). Requires the delete grant added
// in 202609300003_community_livestream_orders_delete_grant.sql.
export async function deleteLivestreamOrder(supabase: SupabaseService, orderId: string): Promise<boolean> {
  const { error } = await supabase.from("community_livestream_orders").delete().eq("id", orderId);
  return !error;
}

// 不再有「社群暱稱審核」這道關卡——真正區分客人身份的是 line_user_id
// 本身（LINE 帳號的唯一識別碼，沒辦法偽造），暱稱只是疊加上去給人看的
// 標籤。community_line_bindings/社群名單審核頁面是另一套舊的記事本/
// 社群訂單系統在用，這裡完全不碰那張表——nickname 欄位直接拿客人當下
// 的 LINE 顯示名稱寫入即可。
async function getLineDisplayName(userId: string): Promise<string> {
  const profile = await getLineUserProfile(userId);
  return profile?.displayName || "客人";
}

type BotState = {
  // 功能五 (自助匯款申報)：這個人現在在等他回覆匯款資訊（欄位名稱
  // 仍叫 awaiting_remittance_last5，是從只問後 5 碼的舊版沿用下來的，
  // 沒有為了這次改成問「銀行/金額/末五碼」三項而特地去改欄位名稱/
  // 加 migration——語意上現在代表「等客人回報完整匯款資訊」），以及
  // 觸發當下記錄的「這次申報涵蓋哪些訂單」快照，避免客人回覆的當下
  // 訂單範圍跟觸發當下不一致（例如中途有新訂單進來或被取消）。
  awaiting_remittance_last5: boolean;
  remittance_order_ids: string[] | null;
  // 連線代購下單改版：「下單模式」狀態——order_mode==="ordering" 代表
  // 這個客人按過「我要下單」、還在閒置逾時/場次結束之前；
  // order_session_id 記錄當初是在哪一場按的（場次結束的判斷要用這個，
  // 不是重新查「現在有沒有進行中的場次」，避免客人正在填照片的途中
  // 下一場剛好開始又被誤判成「還在進行」）；order_last_activity_at 是
  // 「我要下單」「傳照片」「傳好了」任一動作的最後時間，給 10 分鐘
  // 閒置判斷用；order_burst_replied 是「這一輪照片有沒有回過『收到
  // 囉』」的旗標，靠 UPDATE ... WHERE order_burst_replied=false 的原子
  // 寫法決定誰來回覆（見 handleImageMessage）。
  order_mode: "ordering" | null;
  order_session_id: string | null;
  order_last_activity_at: string | null;
  order_burst_replied: boolean;
};

async function getBotState(supabase: SupabaseService, userId: string): Promise<BotState> {
  const { data } = await supabase
    .from("community_line_bot_states")
    .select(
      "awaiting_remittance_last5, remittance_order_ids, order_mode, order_session_id, order_last_activity_at, order_burst_replied",
    )
    .eq("line_user_id", userId)
    .maybeSingle();
  const row = data as (BotState & Record<string, unknown>) | null;
  return {
    awaiting_remittance_last5: Boolean(row?.awaiting_remittance_last5),
    remittance_order_ids: Array.isArray(row?.remittance_order_ids) ? row.remittance_order_ids : null,
    order_mode: row?.order_mode === "ordering" ? "ordering" : null,
    order_session_id: typeof row?.order_session_id === "string" ? row.order_session_id : null,
    order_last_activity_at: typeof row?.order_last_activity_at === "string" ? row.order_last_activity_at : null,
    order_burst_replied: Boolean(row?.order_burst_replied),
  };
}

async function setBotState(supabase: SupabaseService, userId: string, patch: Partial<BotState>) {
  await supabase
    .from("community_line_bot_states")
    .upsert({ line_user_id: userId, ...patch }, { onConflict: "line_user_id" });
}

// ---------------------------------------------------------------------------
// 連線代購下單改版：閒置／場次結束的「惰性判斷」——不寫排程、不主動
// 推播，只在客人下一次傳文字/圖片時才檢查。只套用在 order_mode===
// "ordering" 這個狀態，不改變其他任何既有流程（查詢/取消/匯款）的行為。
// postback（例如既有「取消這項」按鈕）不經過這裡——語意上跟下單模式
// 閒置與否無關，中斷它只會讓既有的取消流程體驗變差。
//
// 回傳 true 代表「這次事件請照常往下處理」；回傳 false 代表這次事件已經
// 被這支函式吃掉（場次結束/閒置關閉的提示已經回覆過），呼叫端要直接
// return，不要再處理這次事件本身的內容（例如這次傳的照片不存、這次的
// 文字不比對任何關鍵字）——這是刻意的簡化，不是逐字規格要求，細節在
// AI_HANDOFF.md 有記錄，供使用者核對是否符合預期。
// ---------------------------------------------------------------------------

async function resolveOrderingGate(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
  state: BotState,
): Promise<boolean> {
  if (state.order_mode !== "ordering") return true;

  if (state.order_session_id) {
    const { data: session } = await supabase
      .from("community_livestream_sessions")
      .select("ends_at")
      .eq("id", state.order_session_id)
      .maybeSingle();
    const ended = !session || new Date((session as { ends_at: string }).ends_at).getTime() <= Date.now();
    if (ended) {
      const { data: stagedRows } = await supabase
        .from("community_livestream_orders")
        .select("id, photo_storage_path")
        .eq("line_user_id", userId)
        .eq("order_status", "staged");
      const rows = (stagedRows as { id: string; photo_storage_path: string | null }[] | null) || [];
      if (rows.length) {
        await supabase
          .from("community_livestream_orders")
          .delete()
          .in("id", rows.map((row) => row.id));
        const paths = rows.map((row) => row.photo_storage_path).filter((path): path is string => Boolean(path));
        await deletePrivateFiles(PHOTO_BUCKET, paths);
      }
      await setBotState(supabase, userId, { order_mode: null, order_session_id: null, order_burst_replied: false });
      await replyTemplate(replyToken, templates, "order_session_ended", { 數量: String(rows.length) });
      return false;
    }
  }

  if (state.order_last_activity_at) {
    const idleMs = Date.now() - new Date(state.order_last_activity_at).getTime();
    if (idleMs > IDLE_TIMEOUT_MINUTES * 60 * 1000) {
      const { count } = await supabase
        .from("community_livestream_orders")
        .select("id", { count: "exact", head: true })
        .eq("line_user_id", userId)
        .eq("order_status", "staged");
      // 只清 order_mode，不清 staged 照片、不清 order_session_id——客人
      // 緊接著的下一則訊息（例如馬上按「傳好了」）會直接通過上面的
      // state.order_mode !== "ordering" 檢查、正常往下跑，不會被二次
      // 攔截，這樣「暫存照片保留，客人隨時按「傳好了」都能進確認頁」
      // 才會成立。
      await setBotState(supabase, userId, { order_mode: null });
      await replyTemplate(replyToken, templates, "order_idle_closed", { 數量: String(count || 0) });
      return false;
    }
  }

  return true;
}

// 「傳好了」快速按鈕——用後台可設定的 photo_confirm 關鍵字組的第一個詞
// 當按鈕送出的文字，不寫死「傳好了」三個字，這樣即使管理員改了關鍵字
// 設定，按鈕送出的文字還是會命中對應的指令。
function photoConfirmQuickReply(keywords: LivestreamKeywords): LineQuickReply {
  const text = keywords.photo_confirm[0] || "傳好了";
  return { items: [{ type: "action", action: { type: "message", label: "傳好了", text } }] };
}

// ---------------------------------------------------------------------------
// 功能一：下單觸發（不再需要任何綁定/審核）——這次改版新增「要先有進行中
// 的連線場次」這個門檻，有的話才開啟下單模式。
// ---------------------------------------------------------------------------

async function handleOrderTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
  keywords: LivestreamKeywords,
) {
  const session = await getCurrentSession(supabase);
  if (!session) {
    await replyTemplate(replyToken, templates, "order_no_session");
    return;
  }

  await setBotState(supabase, userId, {
    order_mode: "ordering",
    order_session_id: session.id,
    order_last_activity_at: new Date().toISOString(),
    order_burst_replied: false,
  });

  if (replyToken) {
    await sendLineReply(replyToken, [
      {
        type: "text",
        text: renderLivestreamReplyTemplate(templates.order_welcome),
        quickReply: photoConfirmQuickReply(keywords),
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// 功能二：LINE 圖片下單——改版後不再做任何自動辨識（商品名稱/價格都交給
// 客人自己在確認頁填），照片全程安靜暫存成 order_status='staged'，只有
// 每一輪的「第一張」回一次「收到囉」。
// ---------------------------------------------------------------------------

async function handleImageMessage(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  messageId: string,
) {
  if (!messageId) return;

  const templates = await getLivestreamReplyTemplates();
  const { keywords } = await getLivestreamKeywordSettings();
  const state = await getBotState(supabase, userId);

  const shouldProceed = await resolveOrderingGate(supabase, userId, replyToken, templates, state);
  if (!shouldProceed) return;

  // 沒有在下單模式（沒按過「我要下單」，或已經被上面的惰性判斷清掉）：
  // 完全不處理、不下載、不存檔、不回覆。
  if (state.order_mode !== "ordering") return;

  const content = await downloadLineMessageContent(messageId);
  if (!content) {
    await reply(replyToken, "圖片下載失敗，請重新傳送一次。");
    return;
  }

  const storagePath = `${userId}/${messageId}.jpg`;
  try {
    await uploadPrivateFile(PHOTO_BUCKET, storagePath, content.buffer, content.contentType);
  } catch {
    await reply(replyToken, "圖片儲存失敗，請稍後再試一次。");
    return;
  }

  const displayName = await getLineDisplayName(userId);

  // product_name/unit_price 保持 null——不再辨識，交給客人在確認頁填；
  // 商品編號（{LINE顯示名稱}-商品{N}）也延後到「送出訂單」當下才產生
  // （見 submit_livestream_order RPC），避免客人移除照片後編號出現空洞。
  const { error: insertError } = await supabase.from("community_livestream_orders").insert({
    line_user_id: userId,
    line_display_name: displayName,
    nickname: displayName,
    quantity: 1,
    photo_storage_path: storagePath,
    source: "line",
    order_status: "staged",
  });
  if (insertError) {
    await reply(replyToken, "圖片處理失敗，請稍後再試一次。");
    return;
  }

  await setBotState(supabase, userId, { order_last_activity_at: new Date().toISOString() });

  // 原子「搶」這一輪第一張的回覆權：UPDATE ... WHERE order_burst_replied
  // = false ... RETURNING 本身是單一 SQL 陳述式，客人一次傳很多張、LINE
  // 同時打來多個 webhook 事件時，Postgres 對同一列的並行寫入會自動
  // 排隊，只有一次呼叫會真的把 false 改成 true、拿回非空結果——那一次
  // 才負責回覆，其餘完全安靜。
  const { data: claimed } = await supabase
    .from("community_line_bot_states")
    .update({ order_burst_replied: true })
    .eq("line_user_id", userId)
    .eq("order_burst_replied", false)
    .select("line_user_id");

  if (claimed && claimed.length > 0 && replyToken) {
    await sendLineReply(replyToken, [
      {
        type: "text",
        text: renderLivestreamReplyTemplate(templates.order_photo_first),
        quickReply: photoConfirmQuickReply(keywords),
      },
    ]);
  }
}

type PhotoNameOrderRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
};

// 共用清單項目樣式：小縮圖在左、商品名稱在右的橫向排列——比照舊版
// （還有數量按鈕時）buildOrderItemBlock 用過的尺寸（60px 小圖），只是
// 拿掉了數量/按鈕，純粹是圖片+名稱。「傳好了」確認清單跟「我要匯款」
// 清單都呼叫這同一支函式，不要各自維護一份——兩邊樣式理應完全一致。
// 跟 buildOrderListBubble 的 separator 搭配組成一項接一項往下排的直向
// 清單（不是橫向滑動的 Carousel，橫向排列只發生在單一項目內部）。
// 沒有照片的訂單不顯示壞圖——直接省略圖片，整列只剩商品名稱文字。
async function buildPhotoNameItemBlock(row: PhotoNameOrderRow): Promise<object> {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  rowContents.push({
    type: "box",
    layout: "vertical",
    flex: 1,
    justifyContent: "center",
    contents: [{ type: "text", text: row.product_name || "商品", weight: "bold", wrap: true, size: "sm" }],
  });

  return { type: "box", layout: "horizontal", spacing: "md", contents: rowContents };
}

// 「傳好了」（功能四）：客人傳完照片後觸發，查這個人目前 order_status=
// 'staged' 的筆數——沒有就回「還沒收到照片」；有的話產生一個免登入的
// 確認頁簽章連結（60 分鐘內有效，見 livestream-magic-link.ts），回一張
// Flex 卡片附「確認數量」按鈕開網頁，照片要等客人在那個網頁按「送出
// 訂單」才真的變成正式訂單（見 /api/live/confirm/submit）。
// order_burst_replied 重置成 false，讓客人之後如果還會繼續傳新照片，
// 下一輪的「第一張」能再回覆一次「收到囉」——order_mode 不在這裡清除，
// 客人可能還會繼續傳照片，要撐到閒置逾時或場次結束才清掉（見
// resolveOrderingGate）。
async function handlePhotoConfirmTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { count, error } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId)
    .eq("order_status", "staged");

  if (error) {
    await reply(replyToken, "查詢失敗，請稍後再試一次。");
    return;
  }

  if (!count) {
    await replyTemplate(replyToken, templates, "photo_confirm_empty");
    return;
  }

  await setBotState(supabase, userId, { order_burst_replied: false });

  const token = createLivestreamMagicLink(userId, "order-confirm");
  const confirmUrl = `${getSiteOrigin()}/live/confirm?token=${encodeURIComponent(token)}`;

  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: `收到 ${count} 張照片`, weight: "bold", size: "lg" },
        {
          type: "text",
          text: renderLivestreamReplyTemplate(templates.order_photo_confirm_card),
          wrap: true,
          size: "sm",
          color: "#6b7280",
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          action: { type: "uri", label: "確認數量", uri: confirmUrl },
        },
      ],
    },
  };

  if (replyToken) {
    await sendLineReply(replyToken, [{ type: "flex", altText: `收到 ${count} 張照片`, contents: bubble }]);
  }
}

// 匯款/取消訂單清單共用的 Flex 容器——把已經組好的 item block 陣列接上
// separator 包成一個直向堆疊的 bubble。原本也被「好了」的數量確認清單
// 共用，那個功能整組移除後，這支純容器函式本身還有用（匯款清單繼續
// 靠它），所以留著。
function buildOrderListBubble(itemBlocks: object[]) {
  const bodyContents: object[] = [];
  itemBlocks.forEach((block, index) => {
    if (index > 0) bodyContents.push({ type: "separator", margin: "lg" });
    bodyContents.push(block);
  });
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "lg",
      contents: bodyContents,
    },
  };
}

async function handlePostback(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  data: string,
) {
  const templates = await getLivestreamReplyTemplates();
  const params = new URLSearchParams(data);
  const action = params.get("action") || "";
  const orderId = params.get("order_id") || "";
  if (!orderId) return;

  if (action === "cancel_order") {
    await handleCancelOrder(supabase, userId, orderId, replyToken, templates);
  }
}

// ---------------------------------------------------------------------------
// 功能六：自助取消訂單 — 比照「我要下單」的觸發模式。只有 purchase_status
// 還是 'not_bought' 且 payment_status 還是 'unpaid'（客人還沒進入匯款
// 流程）的訂單能取消；取消即直接硬刪除該筆 community_livestream_orders
// （跟後台的刪除按鈕共用 deleteLivestreamOrder，不另外寫一套邏輯），不留
// 取消紀錄。
//
// 跟功能七「查詢訂單」是兩個完全獨立的功能（上一輪曾經誤把「查詢訂單」
// 當成這組關鍵字的同義詞，這輪已拆開）——這裡只查「還能取消」的子集
// (not_bought + unpaid)，查詢訂單則是不篩選任何狀態、列出全部商品，純
// 展示沒有取消按鈕。
//
// 排版這輪改成直向列表（跟 buildOrderListBubble 那套用分隔線往下排的
// 做法一致），不再是「一張一張橫向滑動的 Carousel」：每一列是圖片在
// 左、商品名稱在中間、「取消這項」按鈕在右邊的同一列三欄式排版，不是
// 舊版 buildCancelBubble「圖片在上、按鈕在下」的堆疊卡片——buildCancelBubble
// 整支已刪除，改用下面的 buildCancelItemBlock。
// ---------------------------------------------------------------------------

type CancellableOrderRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
};

// 單列三欄：縮圖（左）＋ 商品名稱（中，撐滿剩餘空間）＋「取消這項」
// 按鈕（右）。跟 buildPhotoNameItemBlock 的左右兩欄版型同源，只是多了
// 第三欄的按鈕——兩邊不合併成一支共用函式，因為按鈕這個差異是取消
// 清單獨有的，匯款/查詢訂單都不需要任何互動元件。
async function buildCancelItemBlock(row: CancellableOrderRow): Promise<object> {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  rowContents.push({
    type: "box",
    layout: "vertical",
    flex: 1,
    justifyContent: "center",
    contents: [{ type: "text", text: row.product_name || "商品", weight: "bold", wrap: true, size: "sm" }],
  });
  rowContents.push({
    type: "button",
    style: "primary",
    height: "sm",
    color: "#ef4444",
    flex: 0,
    action: { type: "postback", label: "取消這項", data: `action=cancel_order&order_id=${row.id}`, displayText: "取消這項" },
  });

  return { type: "box", layout: "horizontal", spacing: "md", alignItems: "center", contents: rowContents };
}

async function handleCancelTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  // 只有「還沒購買」且「還沒付款（含匯款確認中）」的訂單才能自助取消——
  // 一旦客人回報過匯款（confirming/paid），就不該再讓他把這筆訂單取消掉。
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, photo_storage_path")
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .eq("purchase_status", "not_bought")
    .eq("payment_status", "unpaid")
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_PER_ROUND * MAX_REPLY_MESSAGES);

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const cancellable = (data as CancellableOrderRow[] | null) || [];
  if (!cancellable.length) {
    await replyTemplate(replyToken, templates, "cancel_empty");
    return;
  }

  // 開頭提示：涵蓋「已購買」跟「已購買以外、但已進入匯款流程（確認中/
  // 已付款）」這兩種不能取消的情況——用「這個人全部訂單筆數 - 可取消
  // 筆數」算出不可取消的總數，不用另外寫一個 OR 條件的查詢。連線代購
  // 下單改版之後，這裡的「全部訂單筆數」要排除 order_status='staged'
  // 的暫存照片——那些還沒送出，不算「不能取消的訂單」，不該被算進
  // 「不可取消」的提示數字裡。
  const { count: totalCount } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId)
    .eq("order_status", "submitted");

  const noncancellableCount = Math.max((totalCount || 0) - cancellable.length, 0);

  const introText =
    noncancellableCount > 0
      ? renderLivestreamReplyTemplate(templates.cancel_intro_partial, { 數量: String(noncancellableCount) })
      : renderLivestreamReplyTemplate(templates.cancel_intro_all);

  const batches = chunk(cancellable, MAX_PHOTOS_PER_ROUND).slice(0, MAX_REPLY_MESSAGES - 1);
  const messages: LineReplyMessage[] = [{ type: "text", text: introText }];
  for (const batch of batches) {
    const itemBlocks = await Promise.all(batch.map((row) => buildCancelItemBlock(row)));
    messages.push({
      type: "flex",
      altText: "請選擇要取消的商品",
      contents: buildOrderListBubble(itemBlocks),
    });
  }

  if (replyToken) await sendLineReply(replyToken, messages);
}

async function handleCancelOrder(
  supabase: SupabaseService,
  userId: string,
  orderId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data: row } = await supabase
    .from("community_livestream_orders")
    .select("product_name, purchase_status, payment_status")
    .eq("id", orderId)
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .maybeSingle();
  if (!row) {
    await reply(replyToken, "找不到這筆訂單，可能已經被取消過了。");
    return;
  }
  if (row.purchase_status !== "not_bought") {
    await replyTemplate(replyToken, templates, "cancel_blocked_bought");
    return;
  }
  if (row.payment_status !== "unpaid") {
    await replyTemplate(replyToken, templates, "cancel_blocked_paying");
    return;
  }

  const label = row.product_name || "這項商品";
  const ok = await deleteLivestreamOrder(supabase, orderId);
  if (!ok) {
    await reply(replyToken, "取消失敗，請稍後再試一次。");
    return;
  }
  await replyTemplate(replyToken, templates, "cancel_success", { 商品名稱: label });
}

// ---------------------------------------------------------------------------
// 功能七：查詢訂單 — 純查詢，不是取消訂單的同義詞（上一輪曾經誤把兩者
// 合併，這輪拆開成獨立功能，見功能六開頭的說明）。列出這個客人**全部**
// 的 community_livestream_orders，不篩選 purchase_status/payment_status
// ——已購買、未購買、確認中、已付款通通列出來，純粹讓客人確認自己
// 下了哪些單，不能從這裡取消任何商品。樣式比照「我要匯款」，直接重用
// buildPhotoNameItemBlock（圖片在左、商品名稱在右，無按鈕）。
// ---------------------------------------------------------------------------

async function handleOrderQueryTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, photo_storage_path")
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_PER_ROUND * MAX_REPLY_MESSAGES);

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as PhotoNameOrderRow[] | null) || [];
  if (!rows.length) {
    await replyTemplate(replyToken, templates, "order_query_empty");
    return;
  }

  const batches = chunk(rows, MAX_PHOTOS_PER_ROUND).slice(0, MAX_REPLY_MESSAGES - 1);
  const messages: LineReplyMessage[] = [{ type: "text", text: renderLivestreamReplyTemplate(templates.order_query_intro) }];
  for (const batch of batches) {
    const itemBlocks = await Promise.all(batch.map((row) => buildPhotoNameItemBlock(row)));
    messages.push({ type: "flex", altText: "您目前下單的商品", contents: buildOrderListBubble(itemBlocks) });
  }

  if (replyToken) await sendLineReply(replyToken, messages);
}

// ---------------------------------------------------------------------------
// 功能五：自助匯款申報 — 比照「我要下單」的觸發模式，全新對話流程。
// 只動 community_livestream_orders 自己的 payment_status 欄位和新的
// community_livestream_remittances 表，不碰 community_orders/
// community_remittance_submissions（那組是舊的記事本系統，存的是客人自己
// 匯出的帳戶資訊，跟這裡的「這次要核對哪些訂單」完全是兩回事）。
// ---------------------------------------------------------------------------

// 收款帳號改成三顆 LINE Flex 原生的 clipboard 按鈕——點了直接把帳號文字
// 複製到客人剪貼簿，不用跳頁、不用打後端。只有後台實際填了帳號的銀行
// 才會出現對應按鈕；三個都沒填就整個不送這則訊息（見呼叫端）。
function buildBankAccountButtonsBubble(accounts: LivestreamBankAccounts) {
  const buttons = LIVESTREAM_BANK_ACCOUNT_KEYS.filter((key) => accounts[key]).map((key) => ({
    type: "button",
    style: "secondary",
    height: "sm",
    action: {
      type: "clipboard",
      label: `複製${LIVESTREAM_BANK_ACCOUNT_LABELS[key]}帳號`,
      clipboardText: accounts[key],
    },
  }));
  if (!buttons.length) return null;

  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: buttons,
    },
  };
}

async function handleRemittanceTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, photo_storage_path")
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .eq("payment_status", "unpaid");

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as PhotoNameOrderRow[] | null) || [];
  if (!rows.length) {
    await replyTemplate(replyToken, templates, "remittance_empty");
    return;
  }

  // 不再檢查/擋下「有商品還沒確認金額」——反正這裡不算金額了，任何
  // unpaid 訂單（不論單價是否已辨識）都直接列出。
  const bankAccounts = await getLivestreamBankAccounts();

  await setBotState(supabase, userId, {
    awaiting_remittance_last5: true,
    remittance_order_ids: rows.map((row) => row.id),
  });

  // 商品清單（共用的「圖片+商品名稱」樣式，跟「傳好了」確認清單一致）
  // → 收款帳號複製按鈕（只有填了帳號的銀行才出現）→ 固定格式的回報
  // 說明文字，三則訊息都在同一次 reply 裡送出，沒超過 LINE 單次 reply
  // 5 則的上限。
  const itemBlocks = await Promise.all(rows.map((row) => buildPhotoNameItemBlock(row)));
  const bankButtonsBubble = buildBankAccountButtonsBubble(bankAccounts);
  const messages: LineReplyMessage[] = [{ type: "flex", altText: "本次下單商品", contents: buildOrderListBubble(itemBlocks) }];
  if (bankButtonsBubble) {
    messages.push({ type: "flex", altText: "收款帳號", contents: bankButtonsBubble });
  }
  messages.push({ type: "text", text: renderLivestreamReplyTemplate(templates.remittance_summary) });
  if (replyToken) await sendLineReply(replyToken, messages);
}

async function handleRemittanceLast5Submission(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
  state: BotState,
  templates: LivestreamReplyTemplates,
) {
  const report = parseRemittanceReport(rawText);
  if (!report) {
    await replyTemplate(replyToken, templates, "remittance_format_invalid");
    return; // stays in awaiting_remittance_last5 so the next message can retry
  }

  const orderIds = state.remittance_order_ids || [];
  if (!orderIds.length) {
    await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null });
    await reply(replyToken, "找不到待申報的匯款資料，請重新輸入「我要匯款」。");
    return;
  }

  const displayName = await getLineDisplayName(userId);
  // amount 這次是客人自己回報的金額（不是系統算的），純記錄供管理員核對
  // 用；community_livestream_remittances.amount 已改成可為 null
  // （202610020001 migration），這裡有值直接寫入即可。
  const { error: insertError } = await supabase.from("community_livestream_remittances").insert({
    line_user_id: userId,
    nickname: displayName,
    order_ids: orderIds,
    bank_name: report.bankName,
    account_last5: report.last5,
    amount: report.amount,
  });
  if (insertError) {
    await reply(replyToken, "匯款申報失敗，請稍後再試一次。");
    return; // keep the awaiting state so the customer can just retry, no need to re-trigger
  }

  await supabase.from("community_livestream_orders").update({ payment_status: "confirming" }).in("id", orderIds);
  await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null });
  await replyTemplate(replyToken, templates, "remittance_success");
}

async function handleTextMessage(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
) {
  const text = rawText.trim();
  if (!text) return;

  const state = await getBotState(supabase, userId);
  const templates = await getLivestreamReplyTemplates();
  const { keywords, enabled } = await getLivestreamKeywordSettings();

  // 連線代購下單改版：閒置／場次結束的惰性判斷放在最前面，只有
  // order_mode==="ordering" 才會真的做事，其餘情況直接通過，對下面的
  // 查詢/取消/匯款/一般關鍵字完全沒有行為改變。
  const shouldProceed = await resolveOrderingGate(supabase, userId, replyToken, templates, state);
  if (!shouldProceed) return;

  // 明確的「取消匯款」逃生指令——檢查順序刻意放在最前面、獨立於下面的
  // awaiting 分支：預設詞「取消匯款」本身同時包含「取消」「匯款」兩個
  // 字，如果放給下面一般的關鍵字比對，客人在非等待狀態打這個詞會被
  // substring 比對誤判成「我要匯款」（或「取消訂單」），反而意外觸發
  // 一個全新的匯款流程——跟這整個功能想避免的「意外觸發」正好相反。
  // 所以提前判斷：有在等待格式才真的執行取消、回覆確認；不在等待狀態
  // 就單純不處理，不落入下面任何一般指令的分派。
  if (matchesEnabledGroup(text, keywords, enabled, "remittance_cancel")) {
    if (state.awaiting_remittance_last5) {
      await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null });
      await replyTemplate(replyToken, templates, "remittance_cancelled");
    }
    return;
  }

  if (state.awaiting_remittance_last5) {
    // 先真的嘗試解析格式，解析成功就直接當有效回報處理，不管文字裡
    // 還夾雜了什麼別的關鍵字——客人很常把機器人剛剛送出的提示文字
    // 整段複製貼上、自己填完答案再送出，提示文字本身就含有「完成」
    // 「匯款」這類字，照舊版「文字裡出現任何已知指令關鍵字就整個放棄
    // 解析格式」的邏輯會被誤判成別的指令，整筆匯款申報從未被記錄。
    // 只有在真的解析不出完整的銀行/金額/末五碼時，才落到下面檢查
    // 客人是不是其實想做別的事。
    if (parseRemittanceReport(text)) {
      await handleRemittanceLast5Submission(supabase, userId, replyToken, text, state, templates);
      return;
    }

    // 其他已知指令優先於「等待匯款格式」狀態：客人可能是不小心點到/
    // 打到「我要匯款」才卡在這裡，根本沒有要匯款。只要這則文字符合
    // order/remittance/cancel/order_query/photo_confirm 任一組**已啟用**
    // 的關鍵字，就視為客人其實是要做別的事——自動清掉等待狀態，直接
    // 照該指令執行，客人完全不會感覺到有「卡住」這回事。停用的組
    // 一律不算數（matchesEnabledGroup 內部已經處理），完全不符合任何
    // 已知關鍵字，才真的當作格式回報來解析（會再次解析失敗，回格式
    // 提醒）。
    const matchesKnownCommand =
      matchesEnabledGroup(text, keywords, enabled, "order") ||
      matchesEnabledGroup(text, keywords, enabled, "remittance") ||
      matchesEnabledGroup(text, keywords, enabled, "cancel") ||
      matchesEnabledGroup(text, keywords, enabled, "order_query") ||
      matchesEnabledGroup(text, keywords, enabled, "photo_confirm");

    if (matchesKnownCommand) {
      await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null });
    } else {
      await handleRemittanceLast5Submission(supabase, userId, replyToken, text, state, templates);
      return;
    }
  }

  if (matchesEnabledGroup(text, keywords, enabled, "order")) {
    await handleOrderTrigger(supabase, userId, replyToken, templates, keywords);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "remittance")) {
    await handleRemittanceTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "cancel")) {
    await handleCancelTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "order_query")) {
    await handleOrderQueryTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "photo_confirm")) {
    await handlePhotoConfirmTrigger(supabase, userId, replyToken, templates);
    return;
  }

  // Anything else: intentionally silent, to avoid noisy/unexpected bot
  // chatter for normal conversation the customer wasn't directing at us.
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleLineEvent(event: LineWebhookEvent): Promise<void> {
  const userId = event.source?.userId;
  if (!userId || event.source?.type !== "user") return; // ignore group/room events for this feature

  const supabase = createSupabaseServiceClient();
  const replyToken = event.replyToken;

  if (event.type === "message" && event.message?.type === "text") {
    await handleTextMessage(supabase, userId, replyToken, String(event.message.text || ""));
    return;
  }
  if (event.type === "message" && event.message?.type === "image") {
    await handleImageMessage(supabase, userId, replyToken, String(event.message.id || ""));
    return;
  }
  if (event.type === "postback") {
    await handlePostback(supabase, userId, replyToken, String(event.postback?.data || ""));
    return;
  }
  // follow/unfollow/other event types: no-op for this feature.
}

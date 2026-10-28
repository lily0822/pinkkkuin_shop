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
  type LivestreamBankAccountKey,
  type LivestreamBankAccounts,
} from "./livestream-bank-info";
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
import { getCurrentSession, getCurrentOrMostRecentSession } from "./livestream-sessions";
import { createLivestreamMagicLink } from "./livestream-magic-link";
import { effectiveLivestreamUnitPrice, effectiveLivestreamQuantity } from "./livestream-pricing";

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
// 「我要匯款」第三階段整個重寫：固定格式文字回報拿掉，改成「連線/
// 預購」兩顆按鈕（這輪只做「連線」，「預購」先回「尚未開放」）→ 選
// 銀行 Quick Reply → 確認金額/轉帳 → 回覆末五碼 → 完成卡片。金額不再
// 是客人自己算、自己打——選「連線」那一刻系統就算好（Σ 有效數量 ×
// 有效單價）存成快照，從頭到尾信任這個系統算出來的數字，不是客人自報
// 金額（見功能五 handleRemitStartLive）。
//
// 「查詢訂單」「取消訂單」第二階段整個重寫（見功能六/七
// handleOrderManageTrigger）：兩個關鍵字組現在共用同一個函式，都是回一張
// 帶簽章連結的 Flex 卡片，連去新網頁 /live/orders——客人在網頁上看到
// 「目前這一波連線」（getCurrentOrMostRecentSession）的全部訂單、每項的
// 採買/付款狀態、尚未匯款金額合計，並能修改數量／取消還沒採買、還沒
// 進入匯款流程的項目。
//
// remit_step 等待狀態不是「獨佔」文字輸入的黑洞：handleTextMessage 在
// remit_step==='await_last5' 時，會先比對 order/remittance/cancel/
// order_query/photo_confirm 任一組已知關鍵字，符合就自動清掉匯款狀態、
// 照常執行該指令；remit_step 是 select_bank/confirm_amount（等按鈕）時
// 已知指令一樣能逃生，其餘文字直接忽略。remittance_cancel（預設「取消
// 匯款」）是明確逃生指令，任何一步都能直接退出。都是為了避免客人不小心
// 碰到「我要匯款」後卡在流程裡出不來。

export type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { id?: string; type?: string; text?: string };
  postback?: { data?: string };
};

export const PHOTO_BUCKET = "community-livestream-photos";
const CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — long enough for LINE to fetch/cache the bubble image
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

type RemitStep = "select_bank" | "confirm_amount" | "await_last5";
type RemitKind = "live" | "preorder";

type BotState = {
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
  // 第三階段：匯款流程的對話狀態機，取代第一、二階段沿用的
  // awaiting_remittance_last5/remittance_order_ids（固定格式文字回報
  // 整個拿掉了）。remit_step 是 null 代表沒有在跑匯款流程；有值時依序
  // select_bank（等客人點銀行 Quick Reply）→ confirm_amount（等客人點
  // 「我已經完成轉帳」）→ await_last5（等客人輸入末五碼文字）。
  // remit_expected_amount 是選「連線」那一刻系統算好的金額快照（不是
  // 客人自己填的），remit_order_ids 是同一時間點涵蓋的訂單 id 快照，
  // 送出當下直接信任這份快照（跟其他地方「觸發時快照、不即時重算」的
  // 慣例一致）。
  remit_step: RemitStep | null;
  remit_kind: RemitKind | null;
  remit_bank: LivestreamBankAccountKey | null;
  remit_expected_amount: number | null;
  remit_order_ids: string[] | null;
};

async function getBotState(supabase: SupabaseService, userId: string): Promise<BotState> {
  const { data } = await supabase
    .from("community_line_bot_states")
    .select(
      "order_mode, order_session_id, order_last_activity_at, order_burst_replied, remit_step, remit_kind, remit_bank, remit_expected_amount, remit_order_ids",
    )
    .eq("line_user_id", userId)
    .maybeSingle();
  const row = data as (BotState & Record<string, unknown>) | null;
  return {
    order_mode: row?.order_mode === "ordering" ? "ordering" : null,
    order_session_id: typeof row?.order_session_id === "string" ? row.order_session_id : null,
    order_last_activity_at: typeof row?.order_last_activity_at === "string" ? row.order_last_activity_at : null,
    order_burst_replied: Boolean(row?.order_burst_replied),
    remit_step:
      row?.remit_step === "select_bank" || row?.remit_step === "confirm_amount" || row?.remit_step === "await_last5"
        ? row.remit_step
        : null,
    remit_kind: row?.remit_kind === "live" || row?.remit_kind === "preorder" ? row.remit_kind : null,
    remit_bank: (LIVESTREAM_BANK_ACCOUNT_KEYS as string[]).includes(String(row?.remit_bank))
      ? (row?.remit_bank as LivestreamBankAccountKey)
      : null,
    remit_expected_amount:
      row?.remit_expected_amount === null || row?.remit_expected_amount === undefined ? null : Number(row.remit_expected_amount),
    remit_order_ids: Array.isArray(row?.remit_order_ids) ? row.remit_order_ids : null,
  };
}

async function setBotState(supabase: SupabaseService, userId: string, patch: Partial<BotState>) {
  await supabase
    .from("community_line_bot_states")
    .upsert({ line_user_id: userId, ...patch }, { onConflict: "line_user_id" });
}

// 匯款流程結束（完成/取消/逃生）時用來一次清空全部 remit_* 欄位。
function clearRemitState(): Partial<BotState> {
  return { remit_step: null, remit_kind: null, remit_bank: null, remit_expected_amount: null, remit_order_ids: null };
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

// ---------------------------------------------------------------------------
// 功能六/七：查詢訂單／取消訂單 — 第二階段整個重寫，兩個關鍵字組現在
// 共用同一個觸發函式。只查「目前這一波連線」（getCurrentOrMostRecentSession）
// 的 submitted 訂單，0 筆回 order_query_empty，有筆數就回一張簽章連結
// Flex 卡片，連去 /live/orders——實際的查看/修改數量/取消互動都在那個
// 網頁上完成，不再像舊版那樣把整份清單塞進 LINE 聊天室（舊版沒有場次
// 範圍、沒有採買/付款狀態顯示，而且 >10 筆會被 chunk+slice 靜默截斷，
// 這些問題這次順便一起解決，不用在聊天室裡維護分頁）。
// ---------------------------------------------------------------------------

async function handleOrderManageTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const session = await getCurrentOrMostRecentSession(supabase);

  let countQuery = supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId)
    .eq("order_status", "submitted");
  countQuery = session ? countQuery.eq("session_id", session.id) : countQuery;

  const { count, error } = await countQuery;
  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  if (!count) {
    await replyTemplate(replyToken, templates, "order_query_empty");
    return;
  }

  const token = createLivestreamMagicLink(userId, "order-edit");
  const ordersUrl = `${getSiteOrigin()}/live/orders?token=${encodeURIComponent(token)}`;

  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: `目前有 ${count} 項訂單`, weight: "bold", size: "lg" },
        {
          type: "text",
          text: renderLivestreamReplyTemplate(templates.order_manage_card),
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
          action: { type: "uri", label: "查看訂單", uri: ordersUrl },
        },
      ],
    },
  };

  if (replyToken) {
    await sendLineReply(replyToken, [{ type: "flex", altText: `目前有 ${count} 項訂單`, contents: bubble }]);
  }
}

// ---------------------------------------------------------------------------
// 功能五：自助匯款申報 — 第三階段全面改版。固定格式文字回報整個拿掉，
// 改成「連線/預購」兩顆按鈕 → 選銀行（Quick Reply）→ 確認金額/轉帳 →
// 回覆末五碼 → 完成卡片。金額不再是客人自己算、自己打——選「連線」那
// 一刻系統就算好（Σ 有效數量 × 有效單價），存進 remit_expected_amount，
// 從頭到尾都信任這個系統算出來的數字。狀態機用
// community_line_bot_states 的 remit_step/remit_kind/remit_bank/
// remit_expected_amount/remit_order_ids（第一階段就建好、這輪第一次
// 真的讀寫）。只動 community_livestream_orders 自己的
// remittance_id/payment_status 欄位和 community_livestream_remittances
// 表，不碰 community_orders/community_remittance_submissions（那組是
// 舊的記事本系統，跟這裡完全是兩回事）。
// ---------------------------------------------------------------------------

// 收款帳號複製按鈕——LINE Flex 原生 clipboard 按鈕，點了直接把帳號文字
// 複製到客人剪貼簿。onlyKey 給定時只顯示那一家（客人選完銀行之後），
// 不給時列出全部已填帳號的銀行。
function buildBankAccountButtonsBubble(accounts: LivestreamBankAccounts, onlyKey?: LivestreamBankAccountKey) {
  const keys = onlyKey ? [onlyKey] : LIVESTREAM_BANK_ACCOUNT_KEYS;
  const buttons = keys
    .filter((key) => accounts[key])
    .map((key) => ({
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

type RemitEligibleRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
  quantity: number;
  purchased_quantity: number | null;
  customer_unit_price: number | null;
  seller_unit_price: number | null;
  unit_price: number | null;
};

// 匯款清單項目：圖片+商品名稱（跟 buildPhotoNameItemBlock 同一套排版）
// 再加一行「數量 N」，還沒採買的項目額外補一句「（還沒採買，用訂購
// 數量估算）」文字提醒——這兩種清單項目長得很像但多了數量行，不跟
// buildPhotoNameItemBlock 合併，避免把「傳好了」確認清單跟匯款清單的
// 排版耦合在一起。
async function buildRemitItemBlock(row: RemitEligibleRow, notYetPurchased: boolean): Promise<object> {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;
  const quantity = effectiveLivestreamQuantity(row.purchased_quantity, row.quantity);

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  const textContents: object[] = [{ type: "text", text: row.product_name || "商品", weight: "bold", wrap: true, size: "sm" }];
  textContents.push({
    type: "text",
    text: notYetPurchased ? `數量 ${quantity}（還沒採買，用訂購數量估算）` : `數量 ${quantity}`,
    size: "xs",
    color: "#6b7280",
    wrap: true,
  });
  rowContents.push({ type: "box", layout: "vertical", flex: 1, justifyContent: "center", contents: textContents });

  return { type: "box", layout: "horizontal", spacing: "md", contents: rowContents };
}

// 功能五：「我要匯款」觸發——不再直接列清單，改回一張「連線／預購」
// 兩顆按鈕的卡片：兩種匯款的資料來源完全不同（連線訂單 vs 網站預購
// 訂單），選了哪種才知道要查哪張表。
async function handleRemittanceTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [{ type: "text", text: renderLivestreamReplyTemplate(templates.remittance_choose_kind), wrap: true, size: "sm" }],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          action: { type: "postback", label: "連線", data: "action=remit_start&kind=live", displayText: "連線" },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "postback", label: "預購", data: "action=remit_start&kind=preorder", displayText: "預購" },
        },
      ],
    },
  };
  if (replyToken) await sendLineReply(replyToken, [{ type: "flex", altText: "請選擇要匯款的類型", contents: bubble }]);
}

// postback action=remit_start&kind=preorder — 這輪只做「連線」，預購
// 清單的資料來源（網站 orders 表 × member_line_accounts 綁定）還沒
// 設計，先回覆「尚未開放」，不異動任何狀態（已跟使用者確認這個範圍）。
async function handleRemitStartPreorder(replyToken: string | undefined, templates: LivestreamReplyTemplates) {
  await replyTemplate(replyToken, templates, "remittance_preorder_unavailable");
}

// postback action=remit_start&kind=live — 查這個客人「隨時可匯款」的
// 連線訂單：order_status='submitted' 且還沒連到任何一筆匯款紀錄
// （remittance_id is null），不限場次、不管這次連線有沒有結束。缺貨
// （賣家已確認買到 0 個）不列入清單，只計入提示筆數；其餘（還沒採買／
// 買到一部分或全部）都納入，數量用「買到幾個（還沒採買就用訂購
// 數量）」，單價用「賣家單價 ?? 客人單價 ?? 舊欄位」。只能整批一起
// 匯款，沒有挑選——這裡查到的全部 id 直接存進 remit_order_ids 快照。
async function handleRemitStartLive(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select(
      "id, product_name, photo_storage_path, quantity, purchased_quantity, customer_unit_price, seller_unit_price, unit_price",
    )
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .is("remittance_id", null);

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as RemitEligibleRow[] | null) || [];
  const shortageCount = rows.filter((row) => row.purchased_quantity === 0).length;
  const eligible = rows.filter((row) => row.purchased_quantity !== 0);

  if (!eligible.length) {
    if (shortageCount) {
      await replyTemplate(replyToken, templates, "remittance_all_shortage", { 數量: String(shortageCount) });
    } else {
      await replyTemplate(replyToken, templates, "remittance_empty");
    }
    return;
  }

  const bankAccounts = await getLivestreamBankAccounts();
  const availableBankKeys = LIVESTREAM_BANK_ACCOUNT_KEYS.filter((key) => bankAccounts[key]);
  if (!availableBankKeys.length) {
    // 後台還沒填任何收款帳號——這個流程沒辦法繼續，不設定 remit_step，
    // 客人之後重新輸入「我要匯款」可以直接重來（不會卡在半途的狀態）。
    await reply(replyToken, "目前尚未設定收款帳號，請直接聯繫賣家協助處理，謝謝。");
    return;
  }

  let expectedAmount = 0;
  const itemBlocks = await Promise.all(
    eligible.map(async (row) => {
      const effectiveQty = effectiveLivestreamQuantity(row.purchased_quantity, row.quantity);
      const effectivePrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price) ?? 0;
      expectedAmount += effectiveQty * effectivePrice;
      return buildRemitItemBlock(row, row.purchased_quantity === null);
    }),
  );

  await setBotState(supabase, userId, {
    remit_step: "select_bank",
    remit_kind: "live",
    remit_bank: null,
    remit_expected_amount: expectedAmount,
    remit_order_ids: eligible.map((row) => row.id),
  });

  const bankQuickReplyItems = availableBankKeys.map((key) => ({
    type: "action" as const,
    action: {
      type: "postback",
      label: LIVESTREAM_BANK_ACCOUNT_LABELS[key],
      data: `action=remit_bank&bank=${key}`,
      displayText: `選擇 ${LIVESTREAM_BANK_ACCOUNT_LABELS[key]}`,
    },
  }));

  const introText =
    renderLivestreamReplyTemplate(templates.remittance_items_intro, { 金額: String(expectedAmount) }) +
    (shortageCount ? renderLivestreamReplyTemplate(templates.remittance_shortage_note, { 數量: String(shortageCount) }) : "");

  const messages: LineReplyMessage[] = [
    { type: "flex", altText: "本次要匯款的商品", contents: buildOrderListBubble(itemBlocks) },
    { type: "text", text: introText, quickReply: { items: bankQuickReplyItems } },
  ];
  if (replyToken) await sendLineReply(replyToken, messages);
}

// postback action=remit_bank&bank=<key> — 只有 remit_step==='select_bank'
// 時生效，避免舊卡片上的按鈕被重複點擊或在錯誤的時機點擊造成狀態錯亂。
async function handleRemitBankSelect(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  state: BotState,
  bankKey: string,
  templates: LivestreamReplyTemplates,
) {
  if (state.remit_step !== "select_bank" || !(LIVESTREAM_BANK_ACCOUNT_KEYS as string[]).includes(bankKey)) return;

  const key = bankKey as LivestreamBankAccountKey;
  await setBotState(supabase, userId, { remit_step: "confirm_amount", remit_bank: key });

  const bankAccounts = await getLivestreamBankAccounts();
  const bankButtonsBubble = buildBankAccountButtonsBubble(bankAccounts, key);
  const amountText = renderLivestreamReplyTemplate(templates.remittance_items_intro, {
    金額: String(state.remit_expected_amount ?? 0),
  });

  const messages: LineReplyMessage[] = [];
  if (bankButtonsBubble) messages.push({ type: "flex", altText: "收款帳號", contents: bankButtonsBubble });
  messages.push({
    type: "flex",
    altText: "請確認金額並完成轉帳",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [{ type: "text", text: amountText, wrap: true, size: "sm" }],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: { type: "postback", label: "我已經完成轉帳", data: "action=remit_confirm", displayText: "我已經完成轉帳" },
          },
        ],
      },
    },
  });
  if (replyToken) await sendLineReply(replyToken, messages);
}

// postback action=remit_confirm — 只有 remit_step==='confirm_amount'
// 時生效。
async function handleRemitConfirm(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  state: BotState,
  templates: LivestreamReplyTemplates,
) {
  if (state.remit_step !== "confirm_amount") return;
  await setBotState(supabase, userId, { remit_step: "await_last5" });
  await replyTemplate(replyToken, templates, "remittance_ask_last5");
}

// 文字訊息、remit_step==='await_last5' 時觸發——把輸入文字當末五碼
// 解析（純 5 碼數字，不是固定格式整段解析），驗證通過才真的寫入資料庫。
async function handleRemitLast5Submission(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
  state: BotState,
  templates: LivestreamReplyTemplates,
) {
  const last5 = rawText.replace(/\D/g, "");
  if (!/^\d{5}$/.test(last5)) {
    await replyTemplate(replyToken, templates, "remittance_last5_invalid");
    return; // 留在 await_last5，客人可以直接重新輸入
  }

  const orderIds = state.remit_order_ids || [];
  const bankKey = state.remit_bank;
  if (!orderIds.length || !bankKey) {
    await setBotState(supabase, userId, clearRemitState());
    await reply(replyToken, "找不到待申報的匯款資料，請重新輸入「我要匯款」。");
    return;
  }

  const displayName = await getLineDisplayName(userId);
  // amount 是選「連線」那一刻系統算好的金額快照（remit_expected_amount），
  // 不是客人自己填的——跟舊版「客人自報金額」是完全不同的信任模型。
  const { data: inserted, error: insertError } = await supabase
    .from("community_livestream_remittances")
    .insert({
      line_user_id: userId,
      nickname: displayName,
      order_ids: orderIds,
      bank_name: LIVESTREAM_BANK_ACCOUNT_LABELS[bankKey],
      account_last5: last5,
      amount: state.remit_expected_amount,
      kind: "live",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await reply(replyToken, "匯款申報失敗，請稍後再試一次。");
    return; // 留在 await_last5，客人可以直接重試，不用重新觸發整個流程
  }

  // guarded update——只更新還是 submitted 且還沒連到任何匯款紀錄的那些
  // id（理論上不會有變化，客人同時跑兩次流程才可能發生，極端邊界，
  // 沒更新到的筆就留在原狀，不特別回滾剛剛已經 insert 的紀錄）。
  await supabase
    .from("community_livestream_orders")
    .update({ remittance_id: inserted.id, payment_status: "confirming" })
    .in("id", orderIds)
    .eq("order_status", "submitted")
    .is("remittance_id", null);

  await setBotState(supabase, userId, clearRemitState());

  const { data: doneRows } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, photo_storage_path")
    .in("id", orderIds);
  const doneItemBlocks = await Promise.all(((doneRows as PhotoNameOrderRow[] | null) || []).map((row) => buildPhotoNameItemBlock(row)));

  const messages: LineReplyMessage[] = [
    { type: "flex", altText: "本次匯款涵蓋的商品", contents: buildOrderListBubble(doneItemBlocks) },
    {
      type: "text",
      text: renderLivestreamReplyTemplate(templates.remittance_done, { 金額: String(state.remit_expected_amount ?? 0) }),
    },
  ];
  if (replyToken) await sendLineReply(replyToken, messages);
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

  // 明確的「取消匯款」逃生指令——檢查順序刻意放在最前面：預設詞「取消
  // 匯款」本身同時包含「取消」「匯款」兩個字，如果放給下面一般的關鍵字
  // 比對，客人在非匯款流程中打這個詞會被 substring 比對誤判成「我要
  // 匯款」（或「取消訂單」），反而意外觸發一個全新的流程。有在跑匯款
  // 流程（remit_step 不是 null，不管在哪一步）才真的執行取消、回覆
  // 確認；沒有在跑就單純不處理，不落入下面任何一般指令的分派。
  if (matchesEnabledGroup(text, keywords, enabled, "remittance_cancel")) {
    if (state.remit_step !== null) {
      await setBotState(supabase, userId, clearRemitState());
      await replyTemplate(replyToken, templates, "remittance_cancelled");
    }
    return;
  }

  // 已知指令優先於匯款流程中途的任何一步：客人可能是不小心點到/打到
  // 「我要匯款」才卡在這裡，根本沒有要匯款。只要這則文字符合
  // order/remittance/cancel/order_query/photo_confirm 任一組**已啟用**
  // 的關鍵字，就視為客人其實是要做別的事——自動清掉匯款狀態，直接照
  // 該指令執行，客人完全不會感覺到有「卡住」這回事。停用的組一律不算數
  // （matchesEnabledGroup 內部已經處理）。
  const matchesKnownCommand = () =>
    matchesEnabledGroup(text, keywords, enabled, "order") ||
    matchesEnabledGroup(text, keywords, enabled, "remittance") ||
    matchesEnabledGroup(text, keywords, enabled, "cancel") ||
    matchesEnabledGroup(text, keywords, enabled, "order_query") ||
    matchesEnabledGroup(text, keywords, enabled, "photo_confirm");

  if (state.remit_step === "await_last5") {
    // 真的在等末五碼文字——已知指令才清狀態改走別的分派，否則當成末
    // 五碼解析（不是 5 碼數字會回格式提醒，留在這一步讓客人重試）。
    if (matchesKnownCommand()) {
      await setBotState(supabase, userId, clearRemitState());
    } else {
      await handleRemitLast5Submission(supabase, userId, replyToken, text, state, templates);
      return;
    }
  } else if (state.remit_step !== null) {
    // 卡在等按鈕的步驟（select_bank/confirm_amount）——這兩步是按鈕
    // 導向，客人打字通常是別的意圖。已知指令照樣讓它逃生，其餘文字
    // 直接忽略、不特別回覆，維持跟下單模式一致的低干擾原則。
    if (matchesKnownCommand()) {
      await setBotState(supabase, userId, clearRemitState());
    } else {
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

  if (
    matchesEnabledGroup(text, keywords, enabled, "cancel") ||
    matchesEnabledGroup(text, keywords, enabled, "order_query")
  ) {
    await handleOrderManageTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "photo_confirm")) {
    await handlePhotoConfirmTrigger(supabase, userId, replyToken, templates);
    return;
  }

  // Anything else: intentionally silent, to avoid noisy/unexpected bot
  // chatter for normal conversation the customer wasn't directing at us.
}

// 第三階段起匯款流程改用按鈕 + postback 引導（取消訂單那組 postback 在
// 第二階段已經整個移除，這裡是這輪重新引入的唯一一組 postback action）。
// 不經過 resolveOrderingGate——postback 是客人點擊機器人稍早送出的按鈕，
// 語意上跟「下單模式」閒置與否無關（沿用第二階段以前就有的既有判斷）。
async function handlePostback(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  data: string,
) {
  const templates = await getLivestreamReplyTemplates();
  const params = new URLSearchParams(data);
  const action = params.get("action") || "";

  if (action === "remit_start") {
    const kind = params.get("kind");
    if (kind === "preorder") {
      await handleRemitStartPreorder(replyToken, templates);
    } else if (kind === "live") {
      await handleRemitStartLive(supabase, userId, replyToken, templates);
    }
    return;
  }

  if (action === "remit_bank") {
    const state = await getBotState(supabase, userId);
    await handleRemitBankSelect(supabase, userId, replyToken, state, params.get("bank") || "", templates);
    return;
  }

  if (action === "remit_confirm") {
    const state = await getBotState(supabase, userId);
    await handleRemitConfirm(supabase, userId, replyToken, state, templates);
    return;
  }
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

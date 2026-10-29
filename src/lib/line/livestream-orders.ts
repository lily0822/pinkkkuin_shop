import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl, deletePrivateFiles, uploadPrivateFile } from "@/lib/supabase/storage";
import {
  downloadLineMessageContent,
  getLineUserProfile,
  sendLineReply,
  sendLineReplyText,
  type LineReplyMessage,
} from "./client";
import {
  getLivestreamBankAccounts,
  LIVESTREAM_BANK_ACCOUNT_CODES,
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
import {
  effectiveLivestreamUnitPrice,
  effectiveLivestreamQuantity,
  computeLivestreamPurchaseChip,
  computeLivestreamSettlement,
} from "./livestream-pricing";
import { buildLiveLiffUrl } from "./liff-url";
import { getLineUserBindingLabel } from "./live-bindings";
import { buildCuteButtonFooter, type CuteButtonSpec } from "./flex-buttons";
import { getOrderRequiresBindSetting } from "./livestream-order-gate-settings";

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
// 「我要匯款」第三階段整個重寫，審查後再修正一輪：固定格式文字回報
// 拿掉，改成「連線/預購」兩顆按鈕（這輪只做「連線」，「預購」先回
// 「尚未開放」）→ 選銀行 Quick Reply → 秀收款帳號 +「我已經完成轉帳」
// 按鈕 →（獨立一步）確認金額「應匯金額 NT$X，你匯的金額是這個嗎？」
// +「金額正確」/「我匯的不一樣」→（選「我匯的不一樣」才會多出）輸入
// 實際金額 → 回覆末五碼 → 完成卡片。**金額是客人可以回報的，不是永遠
// 信任系統算出來的數字**——選「連線」當下系統算好的金額只是拿來問
// 「你匯的是這個嗎」，客人確認不一樣的話會改用客人自己輸入的金額
// （這樣後台的「金額不符」標示才有意義：客人真的匯錯金額時能被標記
// 出來，不會因為永遠存系統算的數字而失效）。送出當下
// （handleRemitLast5Submission 呼叫的 submit_livestream_remittance RPC，
// 202610280002 migration）會另外即時重算一次系統應收金額存成
// expected_amount_at_submit 參考紀錄，跟客人回報的 amount 分開存，後台
// 比對永遠用即時重算的金額（賣家事後改價格/採買結果都會反映），不是
// 這個存檔當下的快照。整個 insert 匯款紀錄 + 更新訂單狀態包在這支 RPC
// 單一交易裡，用 SELECT...FOR UPDATE 鎖定訂單列——LINE webhook 重送或
// 客人連點末五碼，第二次呼叫一定會看到第一次已經寫入的 remittance_id
// 而被擋下，不會產生兩筆匯款紀錄（見功能五 handleRemitStartLive 以下
// 整組函式）。
//
// 「查詢訂單」「取消訂單」第二階段整個重寫（見功能六/七
// handleOrderManageTrigger）：兩個關鍵字組現在共用同一個函式，都是回一張
// 帶簽章連結的 Flex 卡片，連去新網頁 /live/orders——客人在網頁上看到
// 「目前這一波連線」（getCurrentOrMostRecentSession）的全部訂單、每項的
// 採買/付款狀態、尚未匯款金額合計，並能修改數量／取消還沒採買、還沒
// 進入匯款流程的項目。
//
// remit_step 等待狀態不是「獨佔」文字輸入的黑洞：handleTextMessage 在
// remit_step==='await_last5'/'await_custom_amount'（這兩步是等客人打字
// 回答）時，會先比對 order/remittance/cancel/order_query/photo_confirm
// 任一組已知關鍵字，符合就自動清掉匯款狀態、照常執行該指令；remit_step
// 是 select_bank/confirm_transfer/confirm_amount（等按鈕）時已知指令
// 一樣能逃生，其餘文字直接忽略。remittance_cancel（預設「取消匯款」）
// 是明確逃生指令，任何一步都能直接退出。都是為了避免客人不小心碰到
// 「我要匯款」後卡在流程裡出不來。

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

// 社群綁定功能上線這輪：「綁定」「開通」「加入社群」「註冊」從 order
// 組的預設值移除、改放進新的 bind 組，但正式環境資料庫可能還留著舊
// 設定（order 組裡還有這幾個詞）——比對 order 組時先排除掉「同時存在於
// bind 組」的詞，避免舊設定讓「綁定」被誤判成下單。bind 組本身要排在
// 這支之前先檢查（見 handleTextMessage），兩層保護疊在一起。
function matchesOrderGroupExcludingBindWords(
  text: string,
  keywords: LivestreamKeywords,
  enabled: LivestreamKeywordEnabled,
) {
  if (!enabled.order) return false;
  const bindWords = new Set(keywords.bind.map((word) => normalizeText(word)));
  const orderWordsExcludingBind = keywords.order.filter((word) => !bindWords.has(normalizeText(word)));
  return matchesAny(text, orderWordsExcludingBind);
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
// 標籤。community_line_bindings 是另一套舊的記事本/社群訂單系統在用
// （統一綁定之後資料已搬移到 community_line_identities，舊表保留但不再
// 讀寫），這裡完全不碰那張表——nickname 欄位直接拿客人當下的 LINE
// 顯示名稱寫入即可。
async function getLineDisplayName(userId: string): Promise<string> {
  const profile = await getLineUserProfile(userId);
  return profile?.displayName || "客人";
}

// 第三階段審查修正：金額確認拆成獨立一步，不能讓客人覺得「選完銀行跟
// 確認金額是同一件事」——select_bank（選銀行）→ confirm_transfer（秀
// 收款帳號 + 「我已經完成轉帳」按鈕）→ confirm_amount（秀「應匯金額
// NT$X，你匯的金額是這個嗎？」+「金額正確」/「我匯的不一樣」兩顆
// 按鈕）→（選「我匯的不一樣」才會多出）await_custom_amount（等客人
// 輸入實際金額文字）→ await_last5（等末五碼文字）。
type RemitStep = "select_bank" | "confirm_transfer" | "confirm_amount" | "await_custom_amount" | "await_last5";
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
  // 整個拿掉了）。審查後再修正一輪：remit_step 是 null 代表沒有在跑
  // 匯款流程；有值時依序 select_bank（等客人點銀行 Quick Reply）→
  // confirm_transfer（等客人點「我已經完成轉帳」）→ confirm_amount（等
  // 客人點「金額正確」/「我匯的不一樣」）→（選「我匯的不一樣」才會
  // 多出）await_custom_amount（等客人輸入實際金額文字）→ await_last5
  // （等客人輸入末五碼文字）。remit_expected_amount 一開始存選「連線」
  // 那一刻系統算好的金額，拿來在 confirm_amount 這步問客人「是不是匯了
  // 這個數字」；客人選「我匯的不一樣」的話，await_custom_amount 驗證
  // 通過後會覆蓋成客人自己輸入的金額——到 await_last5 這步時，這個欄位
  // 的值永遠是「客人最終確認要回報的金額」，不是固定的系統快照。
  // remit_order_ids 是選「連線」那一刻涵蓋的訂單 id 快照，送出當下直接
  // 信任這份快照（跟其他地方「觸發時快照、不即時重算」的慣例一致），
  // 但送出當下會透過 RPC 重新鎖定+檢查這批訂單是否仍然合法。
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
    remit_step: (
      ["select_bank", "confirm_transfer", "confirm_amount", "await_custom_amount", "await_last5"] as string[]
    ).includes(String(row?.remit_step))
      ? (row?.remit_step as RemitStep)
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
  keywords: LivestreamKeywords,
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
      const idleText = renderLivestreamReplyTemplate(templates.order_idle_closed, { 數量: String(count || 0) });
      // 還有暫存照片時附上「傳好了」卡片按鈕，客人不用自己打字——跟
      // 「我要下單」「收到照片」那兩則提醒同一套 buildPhotoConfirmBubble。
      // 0 張時維持純文字，沒有東西可以確認、按了也只會撲空。
      if (replyToken && count) {
        await sendLineReply(replyToken, [
          { type: "flex", altText: idleText, contents: buildPhotoConfirmBubble(idleText, keywords) },
        ]);
      } else {
        await reply(replyToken, idleText);
      }
      return false;
    }
  }

  return true;
}

// 「傳好了」卡片按鈕——原本是 Quick Reply，這輪改成跟其他卡片一樣的
// 一般 Flex 按鈕（buildCuteButtonFooter），三個會用到的地方（下單歡迎、
// 收到照片、閒置關閉提醒）共用同一個 bubble 產生器。用後台可設定的
// photo_confirm 關鍵字組的第一個詞當按鈕送出的文字，不寫死「傳好了」
// 三個字，這樣即使管理員改了關鍵字設定，按鈕送出的文字還是會命中對應
// 的指令。
function photoConfirmButtonSpec(keywords: LivestreamKeywords): CuteButtonSpec {
  const text = keywords.photo_confirm[0] || "傳好了";
  return { key: "photo_confirm", label: "傳好了", action: { type: "message", label: "傳好了", text } };
}

function buildPhotoConfirmBubble(text: string, keywords: LivestreamKeywords): Record<string, unknown> {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [{ type: "text", text, wrap: true, size: "sm" }],
    },
    footer: buildCuteButtonFooter([photoConfirmButtonSpec(keywords)]),
  };
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

  // 下單前必須先綁定（後台「社群綁定」頁可關閉，預設開啟）——沒有進行
  // 中場次時完全不檢查綁定，維持既有「目前沒有進行中的連線」回覆優先
  // （沒有場次本來就沒辦法下單，不用讓客人先去綁定）。
  if (await getOrderRequiresBindSetting()) {
    const binding = await getLineUserBindingLabel(userId);
    if (!binding) {
      await handleOrderRequiresBindTrigger(userId, replyToken, templates);
      return;
    }
  }

  await setBotState(supabase, userId, {
    order_mode: "ordering",
    order_session_id: session.id,
    order_last_activity_at: new Date().toISOString(),
    order_burst_replied: false,
  });

  if (replyToken) {
    const welcomeText = renderLivestreamReplyTemplate(templates.order_welcome);
    await sendLineReply(replyToken, [
      { type: "flex", altText: welcomeText, contents: buildPhotoConfirmBubble(welcomeText, keywords) },
    ]);
  }
}

// 未綁定時擋下下單——不寫入任何 order_mode/暫存狀態，純粹回一張「先
// 綁定」卡片，跟 handleBindTrigger 的卡片不同：這裡只有一顆按鈕
// 【綁定】（一定是未綁定狀態，沒有「修改」可選），而且連結帶
// next=order，讓 /live/bind 頁面綁定成功後能自動幫客人傳「我要下單」，
// 不用客人自己再做一次（見 live-bind-form.tsx）。
async function handleOrderRequiresBindTrigger(
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const bindToken = createLivestreamMagicLink(userId, "bind");
  const bindUrl = buildLiveLiffUrl("bind", bindToken, { mode: "bind", next: "order" });

  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: renderLivestreamReplyTemplate(templates.order_requires_bind_title), weight: "bold", size: "lg" },
        {
          type: "text",
          text: renderLivestreamReplyTemplate(templates.order_requires_bind_body),
          wrap: true,
          size: "sm",
          color: "#6b7280",
        },
      ],
    },
    footer: buildCuteButtonFooter([
      {
        key: "bind",
        label: renderLivestreamReplyTemplate(templates.bind_button_bind),
        action: { type: "uri", label: renderLivestreamReplyTemplate(templates.bind_button_bind), uri: bindUrl },
      },
    ]),
  };

  if (replyToken) {
    await sendLineReply(replyToken, [
      { type: "flex", altText: renderLivestreamReplyTemplate(templates.order_requires_bind_title), contents: bubble },
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

  const shouldProceed = await resolveOrderingGate(supabase, userId, replyToken, templates, state, keywords);
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
    const photoFirstText = renderLivestreamReplyTemplate(templates.order_photo_first);
    await sendLineReply(replyToken, [
      { type: "flex", altText: photoFirstText, contents: buildPhotoConfirmBubble(photoFirstText, keywords) },
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
  const confirmUrl = buildLiveLiffUrl("confirm", token);

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
    footer: buildCuteButtonFooter([
      { key: "confirm_quantity", label: "確認數量", action: { type: "uri", label: "確認數量", uri: confirmUrl } },
    ]),
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
// 功能六/七：查詢訂單／取消訂單 — 第三版 階段二全面改版：把「目前這一波
// 連線」（跟 /live/orders 網頁同一個 getCurrentOrMostRecentSession 定義）
// 的全部 submitted 訂單用 Flex carousel 列在聊天室裡，每項同時顯示「採買
// 狀態」與「付款狀態」兩個標籤（舊版只有一個狀態標籤，已匯款會蓋掉採買
// 狀態，是這輪要修的問題）；再依付款狀態分成「還沒匯款」「已匯款」兩組
// 卡片。容量保護沿用上一輪「筆數上限 + 位元組上限」的精神，擴大成「多
// 筆縮圖/多張卡片/多則訊息」三層：前 QUERY_PHOTO_CUTOFF 筆帶縮圖，之後
// 改用不帶縮圖的精簡列；每張 bubble 筆數上限依是否帶縮圖而不同；多張
// bubble 依實測位元組大小切分成最多 QUERY_MAX_MESSAGES 則訊息；真的放不
// 下的部分併入最後一張「還有 N 樣」提示卡；任何一則訊息組好後仍超過
// QUERY_HARD_FALLBACK_BYTES 就整個退回最精簡的純文字＋按鈕訊息，確保
// 客人一定會收到東西。
// order_manage_card 這個文案 key 不再被使用（新卡片是直接列商品，沒有
// 一句說明文字可以放）——刻意保留 key 本身不刪，避免後台已存的設定/
// 畫面跟著報錯。
// ---------------------------------------------------------------------------

type OrderManageRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
  quantity: number;
  customer_unit_price: number | null;
  seller_unit_price: number | null;
  unit_price: number | null;
  purchased_quantity: number | null;
  paid_amount: number;
  refunded_at: string | null;
  refunded_amount: number | null;
};

// 兩個標籤的底色——tone 名稱跟 livestream-pricing.ts 的
// LivestreamPurchaseChipTone/LivestreamPaymentChipTone 共用同一組字面值，
// 顏色跟 /live/orders 網頁（live-orders-view.tsx 的 CHIP_TONE_STYLE）故意
// 保持一致，讓客人在聊天室跟網頁看到的顏色不會對不起來。
const QUERY_CHIP_TONE_BG: Record<string, string> = {
  pending: "#eef0f4",
  done: "#e9f8ef",
  out: "#ffe9e9",
  partial: "#fff9df",
  paid: "#ffebf1",
  attention: "#fff4e6",
};

function buildQueryChipBox(label: string, tone: string): object {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: QUERY_CHIP_TONE_BG[tone] || QUERY_CHIP_TONE_BG.pending,
    cornerRadius: "xxl",
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingStart: "10px",
    paddingEnd: "10px",
    flex: 0,
    contents: [{ type: "text", text: label, size: "xxs", color: "#111111", weight: "bold", align: "center", wrap: false }],
  };
}

// 每一項商品一列：有縮圖時跟原本排版一樣；超過 QUERY_PHOTO_CUTOFF 筆之後
// hasPhoto=false，整個跳過圖片元件組出精簡列（商品名稱/單價×數量/兩個
// 狀態標籤仍然齊全，只是少了縮圖），讓同一次回覆能塞進更多筆。
async function buildQueryItemRow(row: OrderManageRow, hasPhoto: boolean): Promise<object> {
  const imageUrl =
    hasPhoto && row.photo_storage_path
      ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
      : null;
  const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
  const isPartial = row.purchased_quantity !== null && row.purchased_quantity > 0 && row.purchased_quantity < row.quantity;
  const quantityText = isPartial ? `買到 ${row.purchased_quantity}` : String(row.quantity);
  const priceText = effectiveUnitPrice === null ? `單價未定 × ${quantityText}` : `NT$${effectiveUnitPrice} × ${quantityText}`;

  const purchaseChip = computeLivestreamPurchaseChip(row.purchased_quantity, row.quantity);
  const settlement = computeLivestreamSettlement({
    effectiveUnitPrice,
    quantity: row.quantity,
    purchasedQuantity: row.purchased_quantity,
    paidAmount: row.paid_amount,
    refundedAt: row.refunded_at,
    refundedAmount: row.refunded_amount,
  });

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "52px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  rowContents.push({
    type: "box",
    layout: "vertical",
    flex: 1,
    justifyContent: "center",
    contents: [
      { type: "text", text: row.product_name || "商品", weight: "bold", size: "sm", wrap: true },
      {
        type: "box",
        layout: "horizontal",
        margin: "xs",
        alignItems: "center",
        contents: [
          { type: "text", text: priceText, size: "xs", color: "#6b7280", wrap: true, flex: 1 },
          {
            type: "box",
            layout: "horizontal",
            spacing: "xs",
            flex: 0,
            contents: [
              buildQueryChipBox(purchaseChip.label, purchaseChip.tone),
              buildQueryChipBox(settlement.paymentChip.label, settlement.paymentChip.tone),
            ],
          },
        ],
      },
    ],
  });

  return { type: "box", layout: "horizontal", spacing: "sm", alignItems: "center", contents: rowContents };
}

// 容量參數：
// - QUERY_PHOTO_CUTOFF：全部（兩組合計）排在前面的筆數才帶縮圖，之後
//   改精簡列，讓整次回覆能塞進更多筆（目標 250 筆以上）。
// - QUERY_ITEMS_PER_BUBBLE_PHOTO/COMPACT：每張 bubble 的筆數上限，精簡列
//   因為少了圖片元件、單筆體積小很多，可以放更多筆。
// - QUERY_MAX_BYTES_PER_MESSAGE：每則訊息 JSON 的目標上限（LINE 單則
//   Flex 訊息硬限制是 50KB，這裡抓更保守的門檻留餘裕）。
// - QUERY_MAX_MESSAGES：一次 reply 最多幾則訊息。
// - QUERY_HARD_FALLBACK_BYTES：任何一則訊息組好後實測仍超過這個門檻，
//   代表容量保護機制本身出了狀況（理論上不該發生），整個回覆退回最精簡
//   的純文字＋按鈕，絕對不能讓客人完全沒反應。
const QUERY_PHOTO_CUTOFF = 60;
const QUERY_ITEMS_PER_BUBBLE_PHOTO = 8;
const QUERY_ITEMS_PER_BUBBLE_COMPACT = 24;
const QUERY_MAX_BYTES_PER_MESSAGE = 35_000;
const QUERY_MAX_MESSAGES = 5;
const QUERY_HARD_FALLBACK_BYTES = 45_000;

function flexJsonByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// 把排好順序的兩組 rows（unpaidRows 已經把「不需匯款」的缺貨項目排到組
// 內最後）組成一串 bubble：第一張 bubble 頂端加場次名稱＋「共 N 樣商品」
// （整次回覆只加一次，不是每組都加）；每組第一張 bubble 加組標題；每組
// 最後一張 bubble 加這組的金額摘要；「還沒匯款」組的每張 bubble 都附上
// 按鈕（兩個按鈕的顯示條件是全域的，不是逐張 bubble 各自判斷）。回傳值
// 同時附上每張 bubble 代表的筆數，方便之後算「還有 N 樣」要算進去的筆數。
async function buildQueryBubbles(
  sessionName: string,
  totalCount: number,
  unpaidRows: OrderManageRow[],
  paidRows: OrderManageRow[],
  unpaidFooter: object | null,
  unpaidFooterLines: object[],
  paidFooterLines: object[],
): Promise<{ bubble: Record<string, unknown>; rowCount: number }[]> {
  const result: { bubble: Record<string, unknown>; rowCount: number }[] = [];
  let globalIndex = 0;
  let isVeryFirstBubble = true;

  async function buildGroup(rows: OrderManageRow[], title: string, titleColor: string, isUnpaidGroup: boolean, footerLines: object[]) {
    if (!rows.length) return;
    let i = 0;
    let isFirstInGroup = true;
    while (i < rows.length) {
      const hasPhoto = globalIndex < QUERY_PHOTO_CUTOFF;
      const chunkSize = hasPhoto ? QUERY_ITEMS_PER_BUBBLE_PHOTO : QUERY_ITEMS_PER_BUBBLE_COMPACT;
      const chunk = rows.slice(i, i + chunkSize);
      const isLastInGroup = i + chunk.length >= rows.length;

      const itemBlocks = await Promise.all(
        chunk.map((row) => {
          const photoForThisRow = globalIndex < QUERY_PHOTO_CUTOFF;
          globalIndex += 1;
          return buildQueryItemRow(row, photoForThisRow);
        }),
      );

      const bodyContents: object[] = [];
      if (isVeryFirstBubble) {
        bodyContents.push({ type: "text", text: sessionName, weight: "bold", size: "md", wrap: true });
        bodyContents.push({ type: "text", text: `共 ${totalCount} 樣商品`, size: "xs", color: "#6b7280" });
        bodyContents.push({ type: "separator", margin: "md" });
        isVeryFirstBubble = false;
      }
      if (isFirstInGroup) {
        bodyContents.push({ type: "text", text: title, weight: "bold", size: "sm", color: titleColor });
        bodyContents.push({ type: "separator", margin: "sm" });
        isFirstInGroup = false;
      }
      itemBlocks.forEach((block, index) => {
        if (index > 0) bodyContents.push({ type: "separator", margin: "md" });
        bodyContents.push(block);
      });
      if (isLastInGroup && footerLines.length) {
        bodyContents.push({ type: "separator", margin: "lg" });
        footerLines.forEach((line) => bodyContents.push(line));
      }

      const bubble: Record<string, unknown> = { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents } };
      if (isUnpaidGroup && unpaidFooter) bubble.footer = unpaidFooter;

      result.push({ bubble, rowCount: chunk.length });
      i += chunk.length;
    }
  }

  await buildGroup(unpaidRows, "還沒匯款", "#b3443f", true, unpaidFooterLines);
  await buildGroup(paidRows, "已匯款", "#2f6b48", false, paidFooterLines);

  return result;
}

function buildQueryOverflowBubble(count: number, adjustButton: object | null): Record<string, unknown> {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [{ type: "text", text: `還有 ${count} 樣，請按下面的按鈕查看全部`, wrap: true, size: "sm" }],
    },
    ...(adjustButton ? { footer: adjustButton } : {}),
  };
}

async function handleOrderManageTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const session = await getCurrentOrMostRecentSession(supabase);

  let query = supabase
    .from("community_livestream_orders")
    .select(
      "id, product_name, photo_storage_path, quantity, customer_unit_price, seller_unit_price, unit_price, purchased_quantity, paid_amount, refunded_at, refunded_amount",
    )
    .eq("line_user_id", userId)
    .eq("order_status", "submitted")
    .order("created_at", { ascending: true });
  query = session ? query.eq("session_id", session.id) : query;

  const { data, error } = await query;
  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as OrderManageRow[] | null) || [];
  if (!rows.length) {
    await replyTemplate(replyToken, templates, "order_query_empty");
    return;
  }

  type Enriched = { row: OrderManageRow; settlement: ReturnType<typeof computeLivestreamSettlement> };
  const enriched: Enriched[] = rows.map((row) => {
    const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
    return {
      row,
      settlement: computeLivestreamSettlement({
        effectiveUnitPrice,
        quantity: row.quantity,
        purchasedQuantity: row.purchased_quantity,
        paidAmount: row.paid_amount,
        refundedAt: row.refunded_at,
        refundedAmount: row.refunded_amount,
      }),
    };
  });

  // 「還沒匯款」組：owed>0 的項目在前（保持原本下單時間順序），缺貨且
  // 從未付款（「不需匯款」）的項目排在這組最後。「已匯款」組：其餘
  // paid>0（或已退款）的項目。
  const unpaidEnriched = enriched.filter((e) => e.settlement.group === "unpaid");
  const paidEnriched = enriched.filter((e) => e.settlement.group === "paid");
  const unpaidNormal = unpaidEnriched.filter((e) => e.settlement.paymentChip.label !== "不需匯款").map((e) => e.row);
  const unpaidShortage = unpaidEnriched.filter((e) => e.settlement.paymentChip.label === "不需匯款").map((e) => e.row);
  const unpaidRows = [...unpaidNormal, ...unpaidShortage];
  const paidRows = paidEnriched.map((e) => e.row);

  const sumOwed = unpaidEnriched.reduce((sum, e) => sum + e.settlement.owed, 0);
  const sumPaid = paidEnriched.reduce((sum, e) => sum + e.row.paid_amount, 0);
  const sumRefundDue = paidEnriched.reduce((sum, e) => sum + e.settlement.refundDue, 0);
  const sumRefunded = paidEnriched.reduce((sum, e) => sum + Number(e.row.refunded_amount || 0), 0);
  // 用「這筆目前算出來的標籤是不是已退款」判斷，不是單看 refunded_at
  // 是否有值——退款標記之後賣家可能又改價/補採買結果，讓這筆重新出現
  // 需補款或預計退款（見 computeLivestreamSettlement 的審查修正），這種
  // 情況下 refunded_at 仍然有值，但這筆已經不該算進「全部都已退款」。
  const allPaidRefunded = paidEnriched.length > 0 && paidEnriched.every((e) => e.settlement.paymentChip.label.startsWith("已退款"));

  // 【調整訂單】只在還有「未採買且未付款」（在 /live/orders 上真的能改）
  // 的商品時才顯示；【我要匯款】只在還有欠款（Σowed>0）時才顯示。兩者
  // 都是全域判斷，不是逐張 bubble 各自判斷。
  const canAdjust = rows.some((row) => row.purchased_quantity === null && row.paid_amount === 0);
  const canRemit = sumOwed > 0;

  const token = createLivestreamMagicLink(userId, "order-edit");
  const ordersUrl = buildLiveLiffUrl("orders", token);
  const adjustButtonSpec: CuteButtonSpec | null = canAdjust
    ? { key: "adjust_orders", label: "調整訂單", action: { type: "uri", label: "調整訂單", uri: ordersUrl } }
    : null;
  const remitButtonSpec: CuteButtonSpec | null = canRemit
    ? {
        key: "remit_quickstart",
        label: "我要匯款",
        action: { type: "postback", label: "我要匯款", data: "action=remit_quickstart", displayText: "我要匯款" },
      }
    : null;
  const adjustButton = adjustButtonSpec ? buildCuteButtonFooter([adjustButtonSpec]) : null;
  const unpaidFooter =
    adjustButtonSpec && remitButtonSpec
      ? buildCuteButtonFooter([adjustButtonSpec, remitButtonSpec])
      : adjustButtonSpec
        ? buildCuteButtonFooter([adjustButtonSpec])
        : remitButtonSpec
          ? buildCuteButtonFooter([remitButtonSpec])
          : null;

  const sessionName = session?.name || "連線訂單";

  const unpaidFooterLines: object[] = unpaidRows.length
    ? [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "還沒匯款", size: "sm", weight: "bold", flex: 1 },
            { type: "text", text: `NT$${Math.round(sumOwed)}`, size: "sm", weight: "bold", align: "end" },
          ],
        },
      ]
    : [];

  const paidFooterLines: object[] = [];
  if (paidRows.length) {
    if (allPaidRefunded) {
      paidFooterLines.push({
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: "已退款", size: "sm", weight: "bold", flex: 1 },
          { type: "text", text: `NT$${Math.round(sumRefunded)}`, size: "sm", weight: "bold", align: "end" },
        ],
      });
    } else {
      paidFooterLines.push({
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: "已匯款", size: "sm", weight: "bold", flex: 1 },
          { type: "text", text: `NT$${Math.round(sumPaid)}`, size: "sm", weight: "bold", align: "end" },
        ],
      });
      if (sumRefundDue > 0) {
        paidFooterLines.push({
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "預計退款", size: "sm", weight: "bold", flex: 1, color: "#9a5b1f" },
            { type: "text", text: `NT$${Math.round(sumRefundDue)}`, size: "sm", weight: "bold", align: "end", color: "#9a5b1f" },
          ],
        });
      }
    }
  }

  const built = await buildQueryBubbles(sessionName, rows.length, unpaidRows, paidRows, unpaidFooter, unpaidFooterLines, paidFooterLines);

  // 把 bubble 依實測位元組大小切成最多 QUERY_MAX_MESSAGES 則訊息：目前這
  // 則訊息加上下一張 bubble 會超過門檻，就把目前這則收起來、從下一張
  // bubble 開始組新的一則；訊息數量到上限之後，剩下的 bubble 全部算進
  // 「還有 N 樣」。
  const messages: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let consumedCount = 0;
  for (const item of built) {
    if (messages.length >= QUERY_MAX_MESSAGES) break;
    const candidate = [...current, item.bubble];
    const size = flexJsonByteSize(candidate.length === 1 ? candidate[0] : { type: "carousel", contents: candidate });
    if (size > QUERY_MAX_BYTES_PER_MESSAGE && current.length > 0) {
      messages.push(current);
      current = [];
      if (messages.length >= QUERY_MAX_MESSAGES) break;
    }
    current = [...current, item.bubble];
    consumedCount += 1;
  }
  if (messages.length < QUERY_MAX_MESSAGES && current.length) {
    messages.push(current);
    current = [];
  }

  const overflowRowCount = built.slice(consumedCount).reduce((sum, item) => sum + item.rowCount, 0);
  if (overflowRowCount > 0) {
    const overflowBubble = buildQueryOverflowBubble(overflowRowCount, adjustButton);
    if (!messages.length) {
      messages.push([overflowBubble]);
    } else {
      const lastIndex = messages.length - 1;
      const lastMessage = [...messages[lastIndex], overflowBubble];
      let size = flexJsonByteSize(lastMessage.length === 1 ? lastMessage[0] : { type: "carousel", contents: lastMessage });
      // 塞進提示卡後若超過門檻，從這則訊息尾端（提示卡之前）移除 bubble
      // 直到低於門檻，被移除的筆數一併算進提示卡的「還有 N 樣」。
      while (size > QUERY_MAX_BYTES_PER_MESSAGE && lastMessage.length > 1) {
        const removedIndex = lastMessage.length - 2;
        lastMessage.splice(removedIndex, 1);
        size = flexJsonByteSize(lastMessage.length === 1 ? lastMessage[0] : { type: "carousel", contents: lastMessage });
      }
      messages[lastIndex] = lastMessage;
    }
  }

  const flexMessages = messages
    .filter((bubbles) => bubbles.length > 0)
    .map((bubbles) => ({
      type: "flex" as const,
      altText: "你的訂單",
      contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    }));

  // 最終防線：任何一則訊息實測仍超過 QUERY_HARD_FALLBACK_BYTES（理論上
  // 不該發生，容量保護機制本身出狀況才會走到這裡），整個回覆退回最精簡
  // 的純文字＋按鈕，絕對不能讓客人完全沒反應。
  const anyTooLarge = flexMessages.some((message) => flexJsonByteSize(message.contents) > QUERY_HARD_FALLBACK_BYTES);
  if (!flexMessages.length || anyTooLarge) {
    if (!replyToken) return;
    if (adjustButton) {
      await sendLineReply(replyToken, [
        {
          type: "flex",
          altText: "你的訂單比較多，請按下面的按鈕查看全部",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              contents: [{ type: "text", text: "你的訂單比較多，請按下面的按鈕查看全部", wrap: true, size: "sm" }],
            },
            footer: adjustButton,
          },
        },
      ]);
    } else {
      await reply(replyToken, "你的訂單比較多，請按下面的按鈕查看全部。");
    }
    return;
  }

  if (replyToken) {
    await sendLineReply(replyToken, flexMessages.slice(0, QUERY_MAX_MESSAGES));
  }
}

// ---------------------------------------------------------------------------
// 功能五：自助匯款申報 — 第三階段全面改版，審查後再修正一輪。固定格式
// 文字回報整個拿掉，改成「連線/預購」兩顆按鈕 → 選銀行（Quick Reply）→
// 秀收款帳號 +「我已經完成轉帳」→ 確認金額「應匯金額 NT$X，你匯的是
// 這個嗎？」+「金額正確」/「我匯的不一樣」→（選「我匯的不一樣」才會
// 多出）輸入實際金額 → 回覆末五碼 → 完成卡片。選「連線」那一刻系統算好
// 的金額（Σ 有效數量 × 有效單價）只是拿來問客人「是不是這個數字」，
// 客人確認不同的話會改用自己輸入的金額——最終送進資料庫的 amount 是
// 客人回報的金額，不是永遠信任系統算出來的數字（這樣後台的「金額不符」
// 標示才有意義）。狀態機用 community_line_bot_states 的
// remit_step/remit_kind/remit_bank/remit_expected_amount/remit_order_ids
// （第一階段就建好、這輪第一次真的讀寫）。送出當下呼叫
// submit_livestream_remittance RPC（202610280002 migration），在單一
// 交易裡鎖定+檢查訂單資格、即時重算一次系統應收金額存成
// expected_amount_at_submit 參考紀錄、insert 匯款紀錄、更新訂單狀態，
// 避免 LINE webhook 重送或客人連點造成重複送出。只動
// community_livestream_orders 自己的 remittance_id/payment_status 欄位
// 和 community_livestream_remittances 表，不碰
// community_orders/community_remittance_submissions（那組是舊的記事本
// 系統，跟這裡完全是兩回事）。
// ---------------------------------------------------------------------------

// 複製出去的文字補上銀行代號（代號 空格 帳號），方便客人轉帳時直接貼；
// 帳號本來就以代號開頭時不重複加一次。
function withBankCode(key: LivestreamBankAccountKey, account: string): string {
  const code = LIVESTREAM_BANK_ACCOUNT_CODES[key];
  if (!code || account.startsWith(code)) return account;
  return `${code} ${account}`;
}

// 收款帳號複製按鈕——LINE Flex 原生 clipboard 按鈕，點了直接把帳號文字
// 複製到客人剪貼簿。onlyKey 給定時只顯示那一家（客人選完銀行之後），
// 不給時列出全部已填帳號的銀行。
function buildBankAccountButtonsBubble(accounts: LivestreamBankAccounts, onlyKey?: LivestreamBankAccountKey) {
  const keys = onlyKey ? [onlyKey] : LIVESTREAM_BANK_ACCOUNT_KEYS;
  const buttons: CuteButtonSpec[] = keys
    .filter((key) => accounts[key])
    .map((key) => ({
      key: "copy_bank_account",
      label: `複製${LIVESTREAM_BANK_ACCOUNT_LABELS[key]}帳號`,
      action: {
        type: "clipboard",
        label: `複製${LIVESTREAM_BANK_ACCOUNT_LABELS[key]}帳號`,
        clipboardText: withBankCode(key, accounts[key]),
      },
    }));
  if (!buttons.length) return null;

  return {
    type: "bubble",
    body: buildCuteButtonFooter(buttons),
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
  paid_amount: number;
};

// 匯款清單項目：圖片+商品名稱（跟 buildPhotoNameItemBlock 同一套排版）
// 再加一行「NT$單價 × 數量 = NT$小計」（不管有沒有採買都用同一種顯示，
// 不再額外標「還沒採買，用訂購數量估算」）；owed>0 且 paid_amount>0
// （補差額：之前已經匯過一部分，這次只是補差額）再多補一句「補差額
// NT$owed」。這三種清單項目長得很像但內容不同，不跟 buildPhotoNameItemBlock
// 合併，避免把「傳好了」確認清單跟匯款清單的排版耦合在一起。
async function buildRemitItemBlock(row: RemitEligibleRow, effectiveUnitPrice: number | null, owed: number): Promise<object> {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;
  const quantity = effectiveLivestreamQuantity(row.purchased_quantity, row.quantity);
  const isTopup = row.paid_amount > 0 && owed > 0;

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  const textContents: object[] = [{ type: "text", text: row.product_name || "商品", weight: "bold", wrap: true, size: "sm" }];
  const quantityText =
    effectiveUnitPrice === null
      ? `數量 ${quantity}`
      : `NT$${Math.round(effectiveUnitPrice)} × ${quantity} = NT$${Math.round(effectiveUnitPrice * quantity)}`;
  textContents.push({
    type: "text",
    text: quantityText,
    size: "xs",
    color: "#6b7280",
    wrap: true,
  });
  if (isTopup) {
    textContents.push({ type: "text", text: `補差額 NT$${Math.round(owed)}`, size: "xs", color: "#9a5b1f", wrap: true });
  }
  rowContents.push({ type: "box", layout: "vertical", flex: 1, justifyContent: "center", contents: textContents });

  return { type: "box", layout: "horizontal", spacing: "md", contents: rowContents };
}

// 功能五：「我要匯款」觸發——【一般商品／扭蛋 分類 v2】這輪起，兩種都
// 是連線商品、匯款不分類，不再問「連線／預購」，直接進連線匯款流程
// （等同查詢訂單卡片上的【我要匯款】按鈕，見下面 handleRemitStartLive）。
// 「連線／預購」選擇卡片（原 handleRemittanceTrigger）、
// remittance_choose_kind 範本、handleRemitStartPreorder、postback
// remit_start&kind=preorder 的處理全部保留不刪，只是畫面上不再觸發，
// 保留以後要重新開放「預購」匯款時可以直接接回來。

// postback action=remit_start&kind=preorder — 這輪只做「連線」，預購
// 清單的資料來源（網站 orders 表 × member_line_accounts 綁定）還沒
// 設計，先回覆「尚未開放」，不異動任何狀態（已跟使用者確認這個範圍）。
async function handleRemitStartPreorder(replyToken: string | undefined, templates: LivestreamReplyTemplates) {
  await replyTemplate(replyToken, templates, "remittance_preorder_unavailable");
}

// postback action=remit_start&kind=live（或聊天室「查詢訂單」卡片上的
// 【我要匯款】按鈕，action=remit_quickstart，等同直接呼叫這支）— 查這個
// 客人「隨時可匯款」的連線訂單：order_status='submitted'，不限場次、不
// 管這次連線有沒有結束。階段二（結算模型）起改用「owed>0」判斷資格，
// 取代原本的「remittance_id is null」——同一筆訂單可能已經匯過一次，
// 賣家事後調高單價又產生新的欠款，這種「補差額」的訂單這次也要能再被
// 列進來（買到一部分或全部都算欠款，缺貨（買到 0 個，且從未付款）不
// 列入清單，只計入提示筆數），數量用「買到幾個（還沒採買就用訂購
// 數量）」，單價用「賣家單價 ?? 客人單價 ?? 舊欄位」。只能整批一起
// 匯款，沒有挑選——這裡查到的全部 id 直接存進 remit_order_ids 快照，
// 送出當下 RPC 會再重新鎖定+計算一次 owed，不會因為這份快照是舊的
// 而多扣或少扣。
async function handleRemitStartLive(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select(
      "id, product_name, photo_storage_path, quantity, purchased_quantity, customer_unit_price, seller_unit_price, unit_price, paid_amount, refunded_at, refunded_amount",
    )
    .eq("line_user_id", userId)
    .eq("order_status", "submitted");

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as (RemitEligibleRow & { refunded_at: string | null; refunded_amount: number | null })[] | null) || [];
  const enriched = rows.map((row) => {
    const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
    const settlement = computeLivestreamSettlement({
      effectiveUnitPrice,
      quantity: row.quantity,
      purchasedQuantity: row.purchased_quantity,
      paidAmount: row.paid_amount,
      refundedAt: row.refunded_at,
      refundedAmount: row.refunded_amount,
    });
    return { row, settlement, effectiveUnitPrice };
  });
  const shortageCount = enriched.filter((e) => e.settlement.paymentChip.label === "不需匯款").length;
  const eligible = enriched.filter((e) => e.settlement.owed > 0);

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
    eligible.map(async (e) => {
      expectedAmount += e.settlement.owed;
      return buildRemitItemBlock(e.row, e.effectiveUnitPrice, e.settlement.owed);
    }),
  );

  await setBotState(supabase, userId, {
    remit_step: "select_bank",
    remit_kind: "live",
    remit_bank: null,
    remit_expected_amount: Math.round(expectedAmount),
    remit_order_ids: eligible.map((e) => e.row.id),
  });

  const bankButtons: CuteButtonSpec[] = availableBankKeys.map((key) => ({
    key: "select_bank",
    label: LIVESTREAM_BANK_ACCOUNT_LABELS[key],
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

  // 選銀行這輪改成跟其他卡片一樣的一般 Flex 按鈕（原本是 Quick Reply），
  // 放在獨立的一則訊息裡（說明文字在上、按鈕在下），跟商品清單那則
  // bubble 完全分開——這樣商品清單再長也不會擠掉選銀行的按鈕。
  const messages: LineReplyMessage[] = [
    { type: "flex", altText: "本次要匯款的商品", contents: buildOrderListBubble(itemBlocks) },
    {
      type: "flex",
      altText: introText,
      contents: {
        type: "bubble",
        body: { type: "box", layout: "vertical", spacing: "md", contents: [{ type: "text", text: introText, wrap: true, size: "sm" }] },
        footer: buildCuteButtonFooter(bankButtons),
      },
    },
  ];
  if (replyToken) await sendLineReply(replyToken, messages);
}

// postback action=remit_bank&bank=<key> — 只有 remit_step==='select_bank'
// 時生效，避免舊卡片上的按鈕被重複點擊或在錯誤的時機點擊造成狀態錯亂。
// 這一步只秀收款帳號跟「我已經完成轉帳」按鈕——不在這裡問金額，金額
// 確認是點了「我已經完成轉帳」之後才出現的獨立下一步（見
// handleRemitTransferConfirm），避免客人覺得兩個問題被混在一起問。
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
  await setBotState(supabase, userId, { remit_step: "confirm_transfer", remit_bank: key });

  const bankAccounts = await getLivestreamBankAccounts();
  const bankButtonsBubble = buildBankAccountButtonsBubble(bankAccounts, key);

  const messages: LineReplyMessage[] = [];
  if (bankButtonsBubble) messages.push({ type: "flex", altText: "收款帳號", contents: bankButtonsBubble });
  messages.push({
    type: "flex",
    altText: "請完成轉帳",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: renderLivestreamReplyTemplate(templates.remittance_transfer_instruction), wrap: true, size: "sm" },
        ],
      },
      footer: buildCuteButtonFooter([
        {
          key: "transfer_done",
          label: "我已經完成轉帳",
          action: { type: "postback", label: "我已經完成轉帳", data: "action=remit_confirm", displayText: "我已經完成轉帳" },
        },
      ]),
    },
  });
  if (replyToken) await sendLineReply(replyToken, messages);
}

// postback action=remit_confirm — 只有 remit_step==='confirm_transfer'
// 時生效。這裡才真的問金額（獨立一步，不是跟上一步的「完成轉帳」問同
// 一件事）：秀出系統算好的應匯金額，請客人確認是不是匯了這個數字。
async function handleRemitTransferConfirm(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  state: BotState,
  templates: LivestreamReplyTemplates,
) {
  if (state.remit_step !== "confirm_transfer") return;
  await setBotState(supabase, userId, { remit_step: "confirm_amount" });

  const amountText = renderLivestreamReplyTemplate(templates.remittance_confirm_amount_question, {
    金額: String(state.remit_expected_amount ?? 0),
  });
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [{ type: "text", text: amountText, wrap: true, size: "sm" }],
    },
    footer: buildCuteButtonFooter([
      { key: "amount_correct", label: "金額正確", action: { type: "postback", label: "金額正確", data: "action=remit_amount_correct", displayText: "金額正確" } },
      { key: "amount_different", label: "我匯的不一樣", action: { type: "postback", label: "我匯的不一樣", data: "action=remit_amount_different", displayText: "我匯的不一樣" } },
    ]),
  };
  if (replyToken) await sendLineReply(replyToken, [{ type: "flex", altText: "請確認金額", contents: bubble }]);
}

// postback action=remit_amount_correct — 客人確認匯的就是系統算的金額，
// remit_expected_amount 維持原值（已經是系統算的），直接進末五碼步驟。
async function handleRemitAmountCorrect(
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

// postback action=remit_amount_different — 客人匯的金額跟系統算的不同，
// 改問客人實際匯了多少。
async function handleRemitAmountDifferent(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  state: BotState,
  templates: LivestreamReplyTemplates,
) {
  if (state.remit_step !== "confirm_amount") return;
  await setBotState(supabase, userId, { remit_step: "await_custom_amount" });
  await replyTemplate(replyToken, templates, "remittance_ask_custom_amount");
}

// 文字訊息、remit_step==='await_custom_amount' 時觸發——把輸入文字當
// 客人實際匯款金額解析（純正整數），不是固定格式整段解析。驗證通過後
// 覆蓋 remit_expected_amount（這個欄位到這一步已經不需要保留原本系統
// 算的值，往後的語意就是「客人這次要回報的金額」，送出匯款當下
// （handleRemitLast5Submission 呼叫的 RPC）會另外即時重算一次系統應收
// 金額存成參考紀錄，不會跟這裡混淆）。
async function handleRemitCustomAmountSubmission(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
  templates: LivestreamReplyTemplates,
) {
  const digitsOnly = rawText.trim().replace(/,/g, "");
  const amount = /^\d+$/.test(digitsOnly) ? Number(digitsOnly) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    await replyTemplate(replyToken, templates, "remittance_custom_amount_invalid");
    return; // 留在 await_custom_amount，客人可以直接重新輸入
  }
  // 上限 1,000,000——避免手誤多打幾個零，順便擋掉 remittances.amount
  // numeric(12,2) 實際上放不下的誇張數字（那種情況送出當下 RPC 會
  // insert 失敗，客人只會看到不明確的「匯款申報失敗」，不如在這裡先
  // 擋下給明確提示）。
  if (amount > 1_000_000) {
    await replyTemplate(replyToken, templates, "remittance_custom_amount_too_large");
    return; // 留在 await_custom_amount，客人可以直接重新輸入
  }

  await setBotState(supabase, userId, { remit_step: "await_last5", remit_expected_amount: amount });
  await replyTemplate(replyToken, templates, "remittance_ask_last5");
}

// 文字訊息、remit_step==='await_last5' 時觸發——把輸入文字當末五碼
// 解析（純 5 碼數字，不是固定格式整段解析），驗證通過才呼叫
// submit_livestream_remittance RPC 真的寫入資料庫。這支 RPC 把「鎖定
// 這批訂單、檢查資格、insert 匯款紀錄、更新訂單狀態」全部包在同一個
// 交易裡（202610280002 migration）——LINE webhook 重送或客人連點末五碼
// 這則訊息，第二次呼叫一定會因為訂單已經連到第一次建立的匯款紀錄而被
// RPC 擋下（already_remitted），不會產生兩筆匯款紀錄。
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
  const reportedAmount = state.remit_expected_amount;
  if (!orderIds.length || !bankKey || reportedAmount === null) {
    await setBotState(supabase, userId, clearRemitState());
    await reply(replyToken, "找不到待申報的匯款資料，請重新輸入「我要匯款」。");
    return;
  }

  const displayName = await getLineDisplayName(userId);
  const { data: remittanceData, error: rpcError } = await supabase
    .rpc("submit_livestream_remittance", {
      p_line_user_id: userId,
      p_nickname: displayName,
      p_order_ids: orderIds,
      p_bank_name: LIVESTREAM_BANK_ACCOUNT_LABELS[bankKey],
      p_account_last5: last5,
      p_reported_amount: reportedAmount,
    })
    .single();
  // submit_livestream_remittance 沒有在 Supabase 產生的型別清單裡登記
  // 回傳形狀，rpc() 推論出來的型別是空物件——這裡手動標註成實際的
  // community_livestream_remittances 列形狀（只列出這支函式用得到的欄位）。
  const remittance = remittanceData as { id: string } | null;

  if (rpcError || !remittance) {
    await setBotState(supabase, userId, clearRemitState());
    if (rpcError?.message?.includes("already_remitted")) {
      await reply(replyToken, "這批商品已經申報過匯款了，請按「查詢訂單」查看。");
    } else {
      await reply(replyToken, "匯款申報失敗，請稍後再試一次。");
    }
    return;
  }

  await setBotState(supabase, userId, clearRemitState());

  // 這批 orderIds 裡任何一筆的 paid_amount 在這次 RPC 呼叫之前就已經
  // >0（即 RPC 回傳前的舊值），代表這次至少有一筆是「補差額」——用這批
  // id 重新查一次目前的 paid_amount 跟這次送出的 expected_amount_at_submit
  // 沒辦法直接分辨「之前有沒有付過」（RPC 執行完 paid_amount 已經是新值），
  // 所以改用 remittance.order_ids 搭配 remittance.expected_amount_at_submit
  // 之外，直接記錄「這批 id 送出前，是否曾經有任何一筆已經連過
  // remittance_id」最可靠——但送出前的狀態已經不存在，這裡改用更簡單
  // 可靠的訊號：remittance 本身若不是這批訂單「第一次」的匯款紀錄（也就
  // 是這批裡有任何一筆訂單的 remittance_id 不等於這筆新紀錄的 id，代表
  // 那筆訂單原本就連著更早的一筆匯款紀錄），就是補差額。
  const { data: doneRows } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, photo_storage_path, remittance_id")
    .in("id", orderIds);
  const doneRowsTyped = (doneRows as (PhotoNameOrderRow & { remittance_id: string | null })[] | null) || [];
  const hasTopup = doneRowsTyped.some((row) => row.remittance_id !== remittance.id);
  const doneItemBlocks = await Promise.all(doneRowsTyped.map((row) => buildPhotoNameItemBlock(row)));

  const doneTemplateKey = hasTopup ? "remittance_done_topup" : "remittance_done";
  const messages: LineReplyMessage[] = [
    { type: "flex", altText: "本次匯款涵蓋的商品", contents: buildOrderListBubble(doneItemBlocks) },
    { type: "text", text: renderLivestreamReplyTemplate(templates[doneTemplateKey], { 金額: String(reportedAmount) }) },
  ];
  if (replyToken) await sendLineReply(replyToken, messages);
}

// ---------------------------------------------------------------------------
// 功能九：社群綁定——客人輸入 bind 組關鍵字，回一張 Flex 卡片，兩顆
// 並排的 URI 按鈕各自開 LIFF 網頁（/live/bind?mode=bind 或 ?mode=edit），
// 真正的填寫/驗證/衝突檢查都在那個網頁跟 /api/live/bind 完成（見
// live-bind-form.tsx、live-identity-rpc.ts）。這裡只負責：查目前有沒有
// 綁定（決定卡片內文要顯示哪一種）、組出兩顆按鈕的連結。不寫入任何
// 狀態——跟查詢訂單/修改訂單那兩個入口一樣，單純是「開一張帶簽章連結
// 的卡片」，沒有自己的對話狀態機。
// ---------------------------------------------------------------------------

async function handleBindTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const binding = await getLineUserBindingLabel(userId);

  const bindToken = createLivestreamMagicLink(userId, "bind");
  const bindUrl = buildLiveLiffUrl("bind", bindToken, { mode: "bind" });
  const editUrl = buildLiveLiffUrl("bind", bindToken, { mode: "edit" });

  const bodyText = binding
    ? renderLivestreamReplyTemplate(templates.bind_card_body_bound, {
        值: binding.type === "ig" ? `@${binding.value}` : binding.value,
      })
    : renderLivestreamReplyTemplate(templates.bind_card_body_unbound);

  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: renderLivestreamReplyTemplate(templates.bind_card_title), weight: "bold", size: "lg" },
        { type: "text", text: bodyText, wrap: true, size: "sm", color: "#6b7280" },
      ],
    },
    footer: buildCuteButtonFooter([
      {
        key: "bind",
        label: renderLivestreamReplyTemplate(templates.bind_button_bind),
        action: { type: "uri", label: renderLivestreamReplyTemplate(templates.bind_button_bind), uri: bindUrl },
      },
      {
        key: "edit",
        label: renderLivestreamReplyTemplate(templates.bind_button_edit),
        action: { type: "uri", label: renderLivestreamReplyTemplate(templates.bind_button_edit), uri: editUrl },
      },
    ]),
  };

  if (replyToken) {
    await sendLineReply(replyToken, [{ type: "flex", altText: renderLivestreamReplyTemplate(templates.bind_card_title), contents: bubble }]);
  }
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
  const shouldProceed = await resolveOrderingGate(supabase, userId, replyToken, templates, state, keywords);
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
    matchesEnabledGroup(text, keywords, enabled, "bind") ||
    matchesOrderGroupExcludingBindWords(text, keywords, enabled) ||
    matchesEnabledGroup(text, keywords, enabled, "remittance") ||
    matchesEnabledGroup(text, keywords, enabled, "cancel") ||
    matchesEnabledGroup(text, keywords, enabled, "order_query") ||
    matchesEnabledGroup(text, keywords, enabled, "photo_confirm");

  if (state.remit_step === "await_last5" || state.remit_step === "await_custom_amount") {
    // 真的在等客人打字回答（末五碼或自填金額）——已知指令才清狀態改走
    // 別的分派，否則當成該步驟期待的文字解析（格式不對會回提醒，留在
    // 原步驟讓客人重試）。
    if (matchesKnownCommand()) {
      await setBotState(supabase, userId, clearRemitState());
    } else if (state.remit_step === "await_custom_amount") {
      await handleRemitCustomAmountSubmission(supabase, userId, replyToken, text, templates);
      return;
    } else {
      await handleRemitLast5Submission(supabase, userId, replyToken, text, state, templates);
      return;
    }
  } else if (state.remit_step !== null) {
    // 卡在等按鈕的步驟（select_bank/confirm_transfer/confirm_amount）——
    // 這些步驟是按鈕導向，客人打字通常是別的意圖。已知指令照樣讓它
    // 逃生，其餘文字直接忽略、不特別回覆，維持跟下單模式一致的低干擾
    // 原則。
    if (matchesKnownCommand()) {
      await setBotState(supabase, userId, clearRemitState());
    } else {
      return;
    }
  }

  // bind 組排在 order 組之前檢查——「綁定」這類詞這輪從 order 的預設值
  // 移除、改放進 bind，但正式環境資料庫可能還留著舊設定，兩層保護
  // （這裡的優先順序 + matchesOrderGroupExcludingBindWords 排除同名詞）
  // 疊在一起才完全擋得住。
  if (matchesEnabledGroup(text, keywords, enabled, "bind")) {
    await handleBindTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesOrderGroupExcludingBindWords(text, keywords, enabled)) {
    await handleOrderTrigger(supabase, userId, replyToken, templates, keywords);
    return;
  }

  if (matchesEnabledGroup(text, keywords, enabled, "remittance")) {
    await handleRemitStartLive(supabase, userId, replyToken, templates);
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

  // 查詢訂單卡片上的【我要匯款】按鈕——直接進「連線」匯款流程，不再問
  // 「連線／預購」（見第三版 階段二 第六節 3）。
  if (action === "remit_quickstart") {
    await handleRemitStartLive(supabase, userId, replyToken, templates);
    return;
  }

  if (action === "remit_bank") {
    const state = await getBotState(supabase, userId);
    await handleRemitBankSelect(supabase, userId, replyToken, state, params.get("bank") || "", templates);
    return;
  }

  if (action === "remit_confirm") {
    const state = await getBotState(supabase, userId);
    await handleRemitTransferConfirm(supabase, userId, replyToken, state, templates);
    return;
  }

  if (action === "remit_amount_correct") {
    const state = await getBotState(supabase, userId);
    await handleRemitAmountCorrect(supabase, userId, replyToken, state, templates);
    return;
  }

  if (action === "remit_amount_different") {
    const state = await getBotState(supabase, userId);
    await handleRemitAmountDifferent(supabase, userId, replyToken, state, templates);
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

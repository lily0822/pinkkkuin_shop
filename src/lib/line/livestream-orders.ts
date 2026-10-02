import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl, uploadPrivateFile } from "@/lib/supabase/storage";
import {
  downloadLineMessageContent,
  getLineUserProfile,
  sendLineReply,
  sendLineReplyText,
  type LineReplyMessage,
} from "./client";
import { recognizeProductPhoto } from "./vision";
import { recognizePriceFromPhoto } from "./price-ocr";
import {
  getLivestreamBankAccounts,
  LIVESTREAM_BANK_ACCOUNT_KEYS,
  LIVESTREAM_BANK_ACCOUNT_LABELS,
  type LivestreamBankAccounts,
} from "./livestream-bank-info";
import { getLivestreamKeywords } from "./livestream-keywords";
import {
  getLivestreamReplyTemplates,
  renderLivestreamReplyTemplate,
  type LivestreamReplyTemplateKey,
  type LivestreamReplyTemplates,
} from "./livestream-reply-templates";

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
// 客人端數量/價格互動已整組移除：原本的數量確認清單 (Flex +
// 1/2/3/4/5+ 按鈕)、「價格有誤」回報、清單上的「刪除」按鈕、「數量
// 正確」鎖定機制全部拿掉——客人剩「傳照片」「我要匯款」「取消訂單」
// 三件事，數量/價格交給後台人工處理。背景的 recognizeProductPhoto/
// recognizePriceFromPhoto 自動辨識完全沒有改動，只是客人不會再看到/
// 調整這些值。取消訂單清單改成純展示（只剩照片＋商品名稱）。匯款清單
// 改成純圖片直向大圖，系統不計算金額，但客人回報時會自己依固定格式
// 回報「銀行/金額/末五碼」三項，amount 欄位存的是客人自報的金額，純
// 供管理員核對用，不是系統算出來的。後來加回一個極簡的「傳好了」
// 確認信號（見 handlePhotoConfirmTrigger）——跟被整組移除的舊版數量
// 確認清單語意完全不同，純粹是查「最近 10 分鐘內有沒有收到照片」的
// 一句文字回覆，不附清單/按鈕/數量/價格。

export type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { id?: string; type?: string; text?: string };
  postback?: { data?: string };
};

const PHOTO_BUCKET = "community-livestream-photos";
const MAX_PHOTOS_PER_ROUND = 10;
const CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — long enough for LINE to fetch/cache the bubble image
const MAX_REPLY_MESSAGES = 5; // LINE reply API hard limit
// 跟 order_welcome 文案裡「超過 10 分鐘沒上傳新照片，請重新輸入
// 「我要下單」」用的是同一個時間概念——這裡是 handlePhotoConfirmTrigger
// 實際查詢用的時間窗，那邊只是提醒文字本身，兩者數值要保持一致（文案
// 後台可編輯，改了分鐘數的話記得這裡也要一併改）。
const RECENT_PHOTO_WINDOW_MINUTES = 10;

// 四組觸發關鍵字（下單/匯款/取消/傳照片確認）改成後台可設定——實際的
// 預設值/讀取/fallback 邏輯都在 src/lib/line/livestream-keywords.ts，
// 這裡不再寫死陣列，一律透過 getLivestreamKeywords() 在 handleTextMessage
// 裡每則訊息抓一次（讀取失敗會自動 fallback 回預設值，不會直接失效）。

function normalizeText(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function matchesAny(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
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
  const bankName = bankNameRaw.slice(0, 50);

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
};

async function getBotState(supabase: SupabaseService, userId: string): Promise<BotState> {
  const { data } = await supabase
    .from("community_line_bot_states")
    .select("awaiting_remittance_last5, remittance_order_ids")
    .eq("line_user_id", userId)
    .maybeSingle();
  const row = data as BotState | null;
  return {
    awaiting_remittance_last5: Boolean(row?.awaiting_remittance_last5),
    remittance_order_ids: Array.isArray(row?.remittance_order_ids) ? row.remittance_order_ids : null,
  };
}

async function setBotState(supabase: SupabaseService, userId: string, patch: Partial<BotState>) {
  await supabase
    .from("community_line_bot_states")
    .upsert({ line_user_id: userId, ...patch }, { onConflict: "line_user_id" });
}

// ---------------------------------------------------------------------------
// 功能一：下單觸發（不再需要任何綁定/審核）
// ---------------------------------------------------------------------------

async function handleOrderTrigger(replyToken: string | undefined, templates: LivestreamReplyTemplates) {
  await replyTemplate(replyToken, templates, "order_welcome");
}

// ---------------------------------------------------------------------------
// 功能二：LINE 圖片下單
// ---------------------------------------------------------------------------

// 辨識不出商品名稱時，不存 null、也不顯示「未辨識商品」——自動產生一個
// 看得懂的名稱：{LINE顯示名稱}-商品{N}。N 是這個 line_user_id 目前總共
// 有幾筆 community_livestream_orders（不分辨識成功或失敗、跨輪次跨批次
// 都算）+1，直接從資料庫實際筆數算出來，天然不會歸零重算。
async function generateFallbackProductName(supabase: SupabaseService, userId: string, displayName: string) {
  const { count } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId);
  return `${displayName}-商品${(count || 0) + 1}`;
}

async function handleImageMessage(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  messageId: string,
) {
  if (!messageId) return;

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
  const recognized = await recognizeProductPhoto(content.buffer, content.contentType);
  const productName = recognized?.productName || (await generateFallbackProductName(supabase, userId, displayName));

  // Anthropic 視覺辨識沒抓到價格（目前甚至完全沒設定 API 金鑰，一律回傳
  // price:null）時，用免費的白框 OCR 備援試一次（見 price-ocr.ts）。一樣
  // 遵守「不確定就跳過」——OCR 也認不出數字就維持 null，不會拿一個猜測值
  // 蓋掉「沒辦法辨識」這個誠實的狀態。
  //
  // 這支呼叫先前在 Production 造成過一次真正的事故：tesseract.js 的
  // worker thread 用 new Worker(path.join(__dirname, ...)) 動態組路徑
  // 載入 worker-script/node/index.js，這條路徑對 @vercel/nft 的靜態
  // 追蹤（只看 import/require/fs）完全不可見，導致那個檔案（跟它需要的
  // 一切）沒被打包進部署，一呼叫就整個 process 崩潰（exit 129）——不是
  // 辨識失敗，是連 handleImageMessage 都死掉，照片完全沒寫進資料庫。
  // 本機 tsc/eslint/build 全部測不出來，只有真正的 Vercel 部署會炸。
  // 修法在 next.config.ts 的 outputFileTracingIncludes 裡，把
  // worker thread 需要的檔案強制打包進 /api/line/webhook 這個路由——
  // 這支呼叫要重新接回來，前提是那個修法已經在真正的 Vercel 部署上
  // （不是只有本機）驗證過不會再崩潰。
  let unitPrice = recognized?.price ?? null;
  if (unitPrice == null) {
    unitPrice = await recognizePriceFromPhoto(content.buffer);
  }

  const { error: insertError } = await supabase.from("community_livestream_orders").insert({
    line_user_id: userId,
    line_display_name: displayName,
    nickname: displayName,
    product_name: productName,
    unit_price: unitPrice,
    recognized_confidence: recognized?.confidence ?? null,
    quantity: 1,
    photo_storage_path: storagePath,
    source: "line",
  });
  if (insertError) {
    await reply(replyToken, "圖片處理失敗，請稍後再試一次。");
    return;
  }

  // 全程安靜——不回覆任何確認訊息。數量/價格互動已整組移除，客人這端
  // 不再需要看到或確認任何東西，商品名稱/單價仍照常嘗試自動辨識並存進
  // 資料庫，由後台管理員檢視/編輯（見上面的 recognizeProductPhoto /
  // recognizePriceFromPhoto，本輪完全沒有改動這兩支函式本身）。
}

// 傳照片確認：客人傳完照片後打關鍵字（預設「傳好了」），查一下「這個
// 人最近 10 分鐘內有沒有真的收到照片」，純粹回一句文字確認——不是
// 恢復「好了」那套數量確認清單（那套已經整組移除，見上方大段說明），
// 不附任何清單/按鈕/數量/價格資訊，單純是一句文字信號。
async function handlePhotoConfirmTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const sinceIso = new Date(Date.now() - RECENT_PHOTO_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId)
    .gte("created_at", sinceIso);

  if (error) {
    await reply(replyToken, "查詢失敗，請稍後再試一次。");
    return;
  }

  if (count && count > 0) {
    await replyTemplate(replyToken, templates, "photo_confirm_success");
  } else {
    await replyTemplate(replyToken, templates, "photo_confirm_empty");
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
// ---------------------------------------------------------------------------

type CancellableOrderRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
};

// 純展示 + 選取：只顯示照片＋商品名稱，不再顯示數量（數量/價格互動已
// 整組移除，取消訂單純粹是「挑一項刪掉」，不需要任何額外資訊）。
async function buildCancelBubble(row: CancellableOrderRow) {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;

  return {
    type: "bubble",
    ...(imageUrl
      ? { hero: { type: "image", url: imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" } }
      : {}),
    body: {
      type: "box",
      layout: "vertical",
      contents: [{ type: "text", text: row.product_name || "商品", weight: "bold", wrap: true }],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: "#ef4444",
          action: { type: "postback", label: "取消這項", data: `action=cancel_order&order_id=${row.id}`, displayText: "取消這項" },
        },
      ],
    },
  };
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
  // 筆數」算出不可取消的總數，不用另外寫一個 OR 條件的查詢。
  const { count: totalCount } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId);

  const noncancellableCount = Math.max((totalCount || 0) - cancellable.length, 0);

  const introText =
    noncancellableCount > 0
      ? renderLivestreamReplyTemplate(templates.cancel_intro_partial, { 數量: String(noncancellableCount) })
      : renderLivestreamReplyTemplate(templates.cancel_intro_all);

  const batches = chunk(cancellable, MAX_PHOTOS_PER_ROUND).slice(0, MAX_REPLY_MESSAGES - 1);
  const messages: LineReplyMessage[] = [{ type: "text", text: introText }];
  for (const batch of batches) {
    const bubbles = await Promise.all(batch.map((row) => buildCancelBubble(row)));
    messages.push({
      type: "flex",
      altText: "請選擇要取消的商品",
      contents: { type: "carousel", contents: bubbles },
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
// 功能五：自助匯款申報 — 比照「我要下單」的觸發模式，全新對話流程。
// 只動 community_livestream_orders 自己的 payment_status 欄位和新的
// community_livestream_remittances 表，不碰 community_orders/
// community_remittance_submissions（那組是舊的記事本系統，存的是客人自己
// 匯出的帳戶資訊，跟這裡的「這次要核對哪些訂單」完全是兩回事）。
// ---------------------------------------------------------------------------

type UnpaidOrderRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
};

// 純圖片清單、直向排列、圖片放大：拿掉商品名稱文字，每一項就是一張
// 接近滿版寬度的正方形大圖（size:"full" + aspectRatio:"1:1"），跟
// buildOrderListBubble 的 separator 組成一張一張往下排的直向清單，不是
// 橫向滑動的 Carousel。沒有照片的訂單不留白、不顯示壞圖——用一個灰底
// 佔位區塊＋商品名稱文字當 fallback，跟有照片的項目一樣占滿寬度。
async function buildRemittanceItemBlock(row: UnpaidOrderRow): Promise<object> {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;

  if (!imageUrl) {
    return {
      type: "box",
      layout: "vertical",
      aspectRatio: "1:1",
      cornerRadius: "md",
      backgroundColor: "#f1f5f9",
      justifyContent: "center",
      alignItems: "center",
      contents: [{ type: "text", text: row.product_name || "商品", size: "sm", color: "#94a3b8", align: "center", wrap: true }],
    };
  }

  return { type: "image", url: imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" };
}

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
    .eq("payment_status", "unpaid");

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as UnpaidOrderRow[] | null) || [];
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

  // 商品清單（純圖片、直向排列）→ 收款帳號複製按鈕（只有填了帳號的
  // 銀行才出現）→ 固定格式的回報說明文字，三則訊息都在同一次 reply
  // 裡送出，沒超過 LINE 單次 reply 5 則的上限。
  const itemBlocks = await Promise.all(rows.map((row) => buildRemittanceItemBlock(row)));
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

  if (state.awaiting_remittance_last5) {
    await handleRemittanceLast5Submission(supabase, userId, replyToken, text, state, templates);
    return;
  }

  const keywords = await getLivestreamKeywords();

  if (matchesAny(text, keywords.order)) {
    await handleOrderTrigger(replyToken, templates);
    return;
  }

  if (matchesAny(text, keywords.remittance)) {
    await handleRemittanceTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesAny(text, keywords.cancel)) {
    await handleCancelTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesAny(text, keywords.photo_confirm)) {
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

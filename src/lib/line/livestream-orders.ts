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
import { getLivestreamBankInfo } from "./livestream-bank-info";
import { getLivestreamKeywords } from "./livestream-keywords";
import {
  getLivestreamReplyTemplates,
  renderLivestreamReplyTemplate,
  type LivestreamReplyTemplateKey,
  type LivestreamReplyTemplates,
} from "./livestream-reply-templates";

// 功能一 (自助綁定) + 功能二 (LINE 圖片下單對話流程). Everything here talks to
// community_line_bindings (read + insert/update of the self-service columns
// only — requested_nickname/review_status/line_display_name; never touches
// the admin-approval columns directly) and the brand-new
// community_livestream_orders / community_line_bot_states tables. Nothing
// here ever writes to community_orders/community_order_items.
//
// Every reply in this file MUST go through sendLineReply/sendLineReplyText
// (uses the incoming event's replyToken — free, doesn't count against the
// LINE OA's monthly push quota). Never sendLineUserText/sendLineUserFlex
// here — this entire feature is reply-only now (the one push it used to
// have, on order confirmation, was removed by request — see AI_HANDOFF.md).

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

// 四組觸發關鍵字（下單/完成/匯款/取消）改成後台可設定——實際的預設值/
// 讀取/fallback 邏輯都在 src/lib/line/livestream-keywords.ts，這裡不再
// 寫死陣列，一律透過 getLivestreamKeywords() 在 handleTextMessage 裡
// 每則訊息抓一次（讀取失敗會自動 fallback 回預設值，不會直接失效）。

function normalizeText(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function matchesAny(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function parsePositiveInteger(text: string) {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

// 價格有誤回報用的金額輸入——跟 parsePositiveInteger（數量，上限 4 位數）
// 分開寫，金額沒道理卡在 9999 以內。
function parsePriceAmount(text: string) {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

function parseAccountLast5(text: string) {
  const trimmed = text.trim();
  return /^\d{5}$/.test(trimmed) ? trimmed : null;
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

// 25 則客人會實際看到的「主要流程」文案改成後台可編輯（見
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

type BindingRow = {
  line_user_id: string;
  line_display_name: string | null;
  nickname: string | null;
  requested_nickname: string | null;
  review_status: string;
};

async function getBinding(supabase: SupabaseService, userId: string): Promise<BindingRow | null> {
  const { data } = await supabase
    .from("community_line_bindings")
    .select("line_user_id, line_display_name, nickname, requested_nickname, review_status")
    .eq("line_user_id", userId)
    .maybeSingle();
  return (data as BindingRow) || null;
}

function isApprovedBinding(binding: BindingRow | null): binding is BindingRow & { nickname: string } {
  return Boolean(binding && binding.review_status === "approved" && binding.nickname);
}

type BotState = {
  awaiting_nickname: boolean;
  awaiting_quantity_for_order_id: string | null;
  // 功能五 (自助匯款申報)：這個人現在在等他回覆帳號後 5 碼，以及觸發當下
  // 算好的「這次結算涵蓋哪些訂單、總金額多少」快照，避免客人回覆的當下
  // 訂單內容/金額跟觸發當下不一致（例如中途被管理員改了單價）。
  awaiting_remittance_last5: boolean;
  remittance_order_ids: string[] | null;
  remittance_amount: number | null;
  // 客人回報「價格有誤」：點了某一筆訂單的「價格有誤」按鈕後，bot 在等
  // 他輸入認為正確的金額——跟 awaiting_quantity_for_order_id 同樣的
  // 「指向哪一筆訂單」做法。
  awaiting_price_dispute_for_order_id: string | null;
};

async function getBotState(supabase: SupabaseService, userId: string): Promise<BotState> {
  const { data } = await supabase
    .from("community_line_bot_states")
    .select(
      "awaiting_nickname, awaiting_quantity_for_order_id, awaiting_remittance_last5, remittance_order_ids, remittance_amount, awaiting_price_dispute_for_order_id",
    )
    .eq("line_user_id", userId)
    .maybeSingle();
  const row = data as BotState | null;
  return {
    awaiting_nickname: Boolean(row?.awaiting_nickname),
    awaiting_quantity_for_order_id: row?.awaiting_quantity_for_order_id || null,
    awaiting_remittance_last5: Boolean(row?.awaiting_remittance_last5),
    remittance_order_ids: Array.isArray(row?.remittance_order_ids) ? row.remittance_order_ids : null,
    remittance_amount: row?.remittance_amount ?? null,
    awaiting_price_dispute_for_order_id: row?.awaiting_price_dispute_for_order_id || null,
  };
}

async function setBotState(supabase: SupabaseService, userId: string, patch: Partial<BotState>) {
  await supabase
    .from("community_line_bot_states")
    .upsert({ line_user_id: userId, ...patch }, { onConflict: "line_user_id" });
}

// ---------------------------------------------------------------------------
// 功能一：自助綁定
// ---------------------------------------------------------------------------

async function startNicknameRequest(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  await setBotState(supabase, userId, { awaiting_nickname: true });
  await replyTemplate(replyToken, templates, "nickname_ask");
}

async function handleNicknameSubmission(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
  templates: LivestreamReplyTemplates,
) {
  const nickname = rawText.trim().slice(0, 120);
  if (!nickname) {
    await reply(replyToken, "請輸入有效的社群暱稱喔。");
    return;
  }

  // Collision check against already-APPROVED bindings only (not other
  // pending requests) — matches the existing admin-approval flow's own
  // duplicate check in src/app/api/backend/community/members/route.ts,
  // which likewise only rejects against the final `nickname` column.
  const { data: conflict } = await supabase
    .from("community_line_bindings")
    .select("id")
    .ilike("nickname", nickname)
    .neq("line_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (conflict) {
    await replyTemplate(replyToken, templates, "nickname_taken", { 暱稱: nickname });
    return; // stays in awaiting_nickname so the very next message can retry
  }

  const profile = await getLineUserProfile(userId);
  const { error } = await supabase.from("community_line_bindings").upsert(
    {
      line_user_id: userId,
      line_display_name: profile?.displayName || null,
      requested_nickname: nickname,
      review_status: "pending",
    },
    { onConflict: "line_user_id" },
  );
  await setBotState(supabase, userId, { awaiting_nickname: false });

  if (error) {
    await reply(replyToken, "申請送出失敗，請稍後再試一次。");
    return;
  }
  await replyTemplate(replyToken, templates, "nickname_submitted", { 暱稱: nickname });
}

async function handleOrderTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const binding = await getBinding(supabase, userId);
  if (isApprovedBinding(binding)) {
    await replyTemplate(replyToken, templates, "order_welcome");
    return;
  }
  if (binding?.review_status === "pending") {
    await replyTemplate(replyToken, templates, "nickname_pending", { 暱稱: binding.requested_nickname || "" });
    return;
  }
  await startNicknameRequest(supabase, userId, replyToken, templates);
}

// 修改暱稱：跟 handleOrderTrigger 不同，不管目前是完全沒申請過、pending
// 審核中、還是已經 approved，一律直接進入「請輸入您的社群暱稱」流程——
// pending 狀態的人原本用 ORDER_TRIGGER 會卡在「審核中請耐心等候」，這裡
// 刻意不做那個檢查，讓客人隨時都能改成想要的暱稱重新送審。
async function handleEditNicknameTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  await startNicknameRequest(supabase, userId, replyToken, templates);
}

// ---------------------------------------------------------------------------
// 功能二：LINE 圖片下單
// ---------------------------------------------------------------------------

async function countPendingPhotos(supabase: SupabaseService, userId: string) {
  const { count } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId)
    .is("carousel_sent_at", null);
  return count || 0;
}

// 辨識不出商品名稱時，不存 null、也不顯示「未辨識商品」——自動產生一個
// 看得懂的名稱：{LINE顯示名稱}-商品{N}。N 是這個 line_user_id 目前總共
// 有幾筆 community_livestream_orders（不分辨識成功或失敗、跨輪次跨批次
// 都算）+1，直接從資料庫實際筆數算出來，天然不會歸零重算。
async function generateFallbackProductName(supabase: SupabaseService, userId: string, binding: BindingRow) {
  const { count } = await supabase
    .from("community_livestream_orders")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", userId);
  const displayName = binding.line_display_name || binding.nickname || "客人";
  return `${displayName}-商品${(count || 0) + 1}`;
}

async function handleImageMessage(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  messageId: string,
) {
  const templates = await getLivestreamReplyTemplates();
  const binding = await getBinding(supabase, userId);
  if (!isApprovedBinding(binding)) {
    await replyTemplate(replyToken, templates, "not_bound_yet", { 功能名稱: "下單" });
    return;
  }
  if (!messageId) return;

  const pendingBefore = await countPendingPhotos(supabase, userId);

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

  const recognized = await recognizeProductPhoto(content.buffer, content.contentType);
  const productName = recognized?.productName || (await generateFallbackProductName(supabase, userId, binding));

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
    line_display_name: binding.line_display_name,
    nickname: binding.nickname,
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

  // Every other outcome here is intentionally silent — no per-photo "已收到
  // 第 N 張圖片" ack anymore (per instructions: the upload flow should stay
  // quiet until "好了"). The over-10-per-round warning is the one exception,
  // since without it the customer would have no idea why a later photo
  // didn't make it into this round's carousel.
  if (pendingBefore >= MAX_PHOTOS_PER_ROUND) {
    await replyTemplate(replyToken, templates, "photo_over_cap");
  }
}

type PendingOrderRow = {
  id: string;
  product_name: string | null;
  unit_price: number | null;
  quantity: number;
  photo_storage_path: string | null;
};

// 數量確認畫面：從 Carousel（左右滑動的卡片）改成單一 Flex bubble、內容
// 直向堆疊——客人用一般聊天視窗往下捲動瀏覽，不用左右滑動。每個商品的
// 縮圖/名稱/單價/數量/按鈕邏輯不變，只是排版方向從橫向卡片變成直向清單
// 裡的一個區塊；每個按鈕一樣各自帶自己的 order_id 做 postback。
async function buildOrderItemBlock(row: PendingOrderRow) {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;
  // 單價未知時整段不提價格，不再顯示「價格未辨識」這種字樣——只留商品
  // 名稱＋目前數量，看起來就是正常商品。
  const detailText = row.unit_price != null ? `NT$${row.unit_price}　目前數量：${row.quantity}` : `目前數量：${row.quantity}`;

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  rowContents.push({
    type: "box",
    layout: "vertical",
    flex: 1,
    justifyContent: "center",
    contents: [
      { type: "text", text: row.product_name || "商品", weight: "bold", wrap: true, size: "sm" },
      { type: "text", text: detailText, size: "xs", color: "#888888", margin: "sm" },
    ],
  });

  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      { type: "box", layout: "horizontal", spacing: "md", contents: rowContents },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          // 新建立的訂單 quantity 預設就是 1，所以這顆用跟其他不同的
          // primary/粉色樣式，視覺上標示「這是目前的數量」——只在訊息
          // 第一次送出時看得出來，客人之後點別的數量，這則舊訊息本身
          // 不會跟著變色（LINE 平台限制，Flex 訊息發送後內容是靜態的），
          // 但文字確認訊息照常會回覆新數量，這不算 bug。
          // 按鈕標籤改成純數字（1/2/3/4/5+）——5 顆按鈕擠在同一排時，
          // 原本「1件/2件/3件/4件/5件以上」在手機版 LINE 寬度不夠會被
          // 截斷顯示成「...」；postback 的 data/displayText 維持完整
          // 文字不變，只改按鈕上顯示的 label。
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#ec4899",
            action: { type: "postback", label: "1", data: `action=set_qty&order_id=${row.id}&qty=1`, displayText: "設定為 1 件" },
          },
          ...[2, 3, 4].map((qty) => ({
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: `${qty}`, data: `action=set_qty&order_id=${row.id}&qty=${qty}`, displayText: `設定為 ${qty} 件` },
          })),
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: "5+", data: `action=ask_qty&order_id=${row.id}`, displayText: "5 件以上" },
          },
        ],
      },
      // 「價格有誤」獨立一排，不跟 5 顆數量按鈕擠在同一排——塞進同一排
      // 會重新變回原本「1件/2件/3件/4件/5件以上」太寬被截斷成「...」的
      // 老問題（當時就是因為擠不下才把標籤縮成純數字），這是不常用的
      // 次要動作，獨立一排也比較不會被誤觸。
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "價格有誤",
              data: `action=flag_price_dispute&order_id=${row.id}`,
              displayText: "回報價格有誤",
            },
          },
        ],
      },
    ],
  };
}

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

async function handleDoneCommand(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const binding = await getBinding(supabase, userId);
  if (!isApprovedBinding(binding)) {
    await replyTemplate(replyToken, templates, "not_bound_yet", { 功能名稱: "下單" });
    return;
  }

  const maxBatches = MAX_REPLY_MESSAGES - 1; // one reply slot is used by the leading confirmation text below
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, unit_price, quantity, photo_storage_path")
    .eq("line_user_id", userId)
    .is("carousel_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_PER_ROUND * maxBatches);

  const pendingRows = (data as PendingOrderRow[] | null) || [];
  if (error || !pendingRows.length) {
    await replyTemplate(replyToken, templates, "done_empty");
    return;
  }

  // Each batch of 10 becomes ONE vertical-list bubble (not a 10-bubble
  // carousel) — no longer bound by LINE's 12-bubble carousel limit, but kept
  // at the same "one round" batch size for now per instructions (10-20 is
  // fine; revisit only if a single bubble this size turns out too large in
  // practice). LINE still caps a single reply call at 5 messages total —
  // one of those slots is used by the leading "已登錄您的商品" confirmation
  // text below, so up to 4 batches (40 photos) go out per "好了". Anything
  // beyond that stays queued (carousel_sent_at still null) for whatever
  // "好了" comes next; nothing is discarded.
  const batches = chunk(pendingRows, MAX_PHOTOS_PER_ROUND).slice(0, maxBatches);

  const messages: LineReplyMessage[] = [
    { type: "text", text: renderLivestreamReplyTemplate(templates.done_intro) },
  ];
  for (const batch of batches) {
    const itemBlocks = await Promise.all(batch.map((row) => buildOrderItemBlock(row)));
    messages.push({
      type: "flex",
      altText: "請確認您的商品數量",
      contents: buildOrderListBubble(itemBlocks),
    });
  }

  const sentIds = batches.flat().map((row) => row.id);
  await supabase
    .from("community_livestream_orders")
    .update({ carousel_sent_at: new Date().toISOString() })
    .in("id", sentIds);

  if (replyToken) await sendLineReply(replyToken, messages);
}

async function applyQuantityUpdate(
  supabase: SupabaseService,
  userId: string,
  orderId: string,
  quantity: number,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  // LINE 按鈕發出去後沒辦法從視覺上變成不能點——這裡做的是「功能上鎖住」：
  // 按鈕還在、還點得下去，但點了不會真的更新。鎖定後任何數量調整入口
  // （2/3/4件按鈕、5件以上輸入數字，都走這支函式）一律擋下。
  const { data: existing } = await supabase
    .from("community_livestream_orders")
    .select("quantity_locked_at")
    .eq("id", orderId)
    .eq("line_user_id", userId)
    .maybeSingle();
  if (existing?.quantity_locked_at) {
    await replyTemplate(replyToken, templates, "quantity_locked");
    return;
  }

  const { data, error } = await supabase
    .from("community_livestream_orders")
    .update({ quantity })
    .eq("id", orderId)
    .eq("line_user_id", userId)
    .select("product_name")
    .maybeSingle();
  if (error || !data) {
    await reply(replyToken, "更新數量失敗，請稍後再試一次。");
    return;
  }
  // product_name is never null for LINE-sourced rows anymore (see
  // generateFallbackProductName above), so no "這項商品" fallback needed.
  await replyTemplate(replyToken, templates, "quantity_updated", { 商品名稱: data.product_name, 數量: String(quantity) });
}

// 客人回覆「數量正確」(可後台設定的 quantity_confirm 關鍵字組) 後，把
// 這批「已經列在清單裡、還沒鎖定」的訂單一次鎖定——鎖定後
// applyQuantityUpdate 會擋下任何後續的數量調整。只鎖 carousel_sent_at
// 不是 null（已經列出過）且 quantity_locked_at 還是 null（還沒鎖過）的
// 訂單，所以下一輪新照片不受這次鎖定影響。
async function handleQuantityConfirmTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id")
    .eq("line_user_id", userId)
    .not("carousel_sent_at", "is", null)
    .is("quantity_locked_at", null);

  if (error) {
    await reply(replyToken, "查詢訂單失敗，請稍後再試一次。");
    return;
  }

  const rows = (data as { id: string }[] | null) || [];
  if (!rows.length) {
    await replyTemplate(replyToken, templates, "quantity_confirm_empty");
    return;
  }

  const { error: updateError } = await supabase
    .from("community_livestream_orders")
    .update({ quantity_locked_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((row) => row.id),
    );
  if (updateError) {
    await reply(replyToken, "確認失敗，請稍後再試一次。");
    return;
  }

  await replyTemplate(replyToken, templates, "quantity_confirmed");
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

  if (action === "set_qty") {
    const qty = Number(params.get("qty") || "0");
    if (qty > 0) await applyQuantityUpdate(supabase, userId, orderId, Math.round(qty), replyToken, templates);
    return;
  }
  if (action === "ask_qty") {
    await setBotState(supabase, userId, { awaiting_quantity_for_order_id: orderId });
    await replyTemplate(replyToken, templates, "quantity_ask_number");
    return;
  }
  if (action === "cancel_order") {
    await handleCancelOrder(supabase, userId, orderId, replyToken, templates);
    return;
  }
  if (action === "flag_price_dispute") {
    // 已鎖定數量（quantity_locked_at 不是 null）的訂單一樣允許標記價格
    // 有誤——鎖定只鎖數量調整，價格爭議是另一回事，不用額外擋。
    await setBotState(supabase, userId, { awaiting_price_dispute_for_order_id: orderId });
    await replyTemplate(replyToken, templates, "price_dispute_ask_amount");
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
  quantity: number;
  photo_storage_path: string | null;
};

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
      contents: [
        { type: "text", text: row.product_name || "商品", weight: "bold", wrap: true },
        { type: "text", text: `數量：${row.quantity}`, size: "sm", color: "#888888", margin: "sm" },
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
  const binding = await getBinding(supabase, userId);
  if (!isApprovedBinding(binding)) {
    await replyTemplate(replyToken, templates, "not_bound_yet", { 功能名稱: "取消訂單" });
    return;
  }

  // 只有「還沒購買」且「還沒付款（含匯款確認中）」的訂單才能自助取消——
  // 一旦客人回報過匯款（confirming/paid），就不該再讓他把這筆訂單取消掉。
  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, quantity, photo_storage_path")
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
  unit_price: number | null;
  quantity: number;
  total_price: number | null;
  photo_storage_path: string | null;
};

// 待匯款商品清單：比照 buildOrderItemBlock 的「縮圖＋名稱＋數量/金額」
// 直向清單做法，純展示用（不需要按鈕），跟 buildOrderListBubble 組成
// 同一個 Flex bubble。
async function buildRemittanceItemBlock(row: UnpaidOrderRow) {
  const imageUrl = row.photo_storage_path
    ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, CAROUSEL_IMAGE_SIGNED_URL_TTL_SECONDS)
    : null;
  const detailText = `NT$${row.unit_price}　×${row.quantity}　＝　NT$${Number(row.total_price || 0)}`;

  const rowContents: object[] = [];
  if (imageUrl) {
    rowContents.push({ type: "image", url: imageUrl, size: "60px", aspectMode: "cover", aspectRatio: "1:1", flex: 0 });
  }
  rowContents.push({
    type: "box",
    layout: "vertical",
    flex: 1,
    justifyContent: "center",
    contents: [
      { type: "text", text: row.product_name || "未命名商品", weight: "bold", wrap: true, size: "sm" },
      { type: "text", text: detailText, size: "xs", color: "#888888", margin: "sm" },
    ],
  });

  return { type: "box", layout: "horizontal", spacing: "md", contents: rowContents };
}

async function handleRemittanceTrigger(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  templates: LivestreamReplyTemplates,
) {
  const binding = await getBinding(supabase, userId);
  if (!isApprovedBinding(binding)) {
    await replyTemplate(replyToken, templates, "not_bound_yet", { 功能名稱: "匯款申報" });
    return;
  }

  const { data, error } = await supabase
    .from("community_livestream_orders")
    .select("id, product_name, unit_price, quantity, total_price, photo_storage_path")
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

  const unresolvedCount = rows.filter((row) => row.unit_price == null).length;
  if (unresolvedCount > 0) {
    await replyTemplate(replyToken, templates, "remittance_unresolved", { 數量: String(unresolvedCount) });
    return;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total_price || 0), 0);
  const bankInfo = await getLivestreamBankInfo();

  await setBotState(supabase, userId, {
    awaiting_remittance_last5: true,
    remittance_order_ids: rows.map((row) => row.id),
    remittance_amount: total,
  });

  // 商品清單改用帶圖片的 Flex（跟功能二的直向清單同一套做法），總額／
  // 收款資訊／回覆提示接續放在同一次 reply 裡的第二則文字訊息。
  const itemBlocks = await Promise.all(rows.map((row) => buildRemittanceItemBlock(row)));
  const messages: LineReplyMessage[] = [
    { type: "flex", altText: "本次待匯款商品", contents: buildOrderListBubble(itemBlocks) },
    {
      type: "text",
      text: renderLivestreamReplyTemplate(templates.remittance_summary, { 總額: String(total), 收款資訊: bankInfo || "" }),
    },
  ];
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
  const last5 = parseAccountLast5(rawText);
  if (!last5) {
    await reply(replyToken, "請輸入正確的匯款帳號後 5 碼（純數字 5 碼），例如：12345。");
    return; // stays in awaiting_remittance_last5 so the next message can retry
  }

  const orderIds = state.remittance_order_ids || [];
  const amount = state.remittance_amount ?? 0;
  if (!orderIds.length) {
    await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null, remittance_amount: null });
    await reply(replyToken, "找不到待申報的匯款資料，請重新輸入「我要匯款」。");
    return;
  }

  const binding = await getBinding(supabase, userId);
  const { error: insertError } = await supabase.from("community_livestream_remittances").insert({
    line_user_id: userId,
    nickname: binding?.nickname || "",
    order_ids: orderIds,
    account_last5: last5,
    amount,
  });
  if (insertError) {
    await reply(replyToken, "匯款申報失敗，請稍後再試一次。");
    return; // keep the awaiting state so the customer can just retry, no need to re-trigger
  }

  await supabase.from("community_livestream_orders").update({ payment_status: "confirming" }).in("id", orderIds);
  await setBotState(supabase, userId, { awaiting_remittance_last5: false, remittance_order_ids: null, remittance_amount: null });
  await replyTemplate(replyToken, templates, "remittance_success");
}

// ---------------------------------------------------------------------------
// 客人回報「價格有誤」：純粹留一個給管理員參考的標記 + 建議金額，不會
// 自動覆蓋 unit_price——真正要不要採用、怎麼修正由管理員在後台決定。
// ---------------------------------------------------------------------------

async function handlePriceDisputeSubmission(
  supabase: SupabaseService,
  userId: string,
  replyToken: string | undefined,
  rawText: string,
  orderId: string,
  templates: LivestreamReplyTemplates,
) {
  const amount = parsePriceAmount(rawText);
  if (amount === null) {
    await replyTemplate(replyToken, templates, "price_dispute_invalid_amount");
    return; // stays in awaiting_price_dispute_for_order_id so the next message can retry
  }

  await supabase
    .from("community_livestream_orders")
    .update({ price_disputed_at: new Date().toISOString(), price_dispute_suggested_price: amount })
    .eq("id", orderId)
    .eq("line_user_id", userId);
  await setBotState(supabase, userId, { awaiting_price_dispute_for_order_id: null });
  await replyTemplate(replyToken, templates, "price_dispute_received");
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

  if (state.awaiting_nickname) {
    await handleNicknameSubmission(supabase, userId, replyToken, text, templates);
    return;
  }

  if (state.awaiting_remittance_last5) {
    await handleRemittanceLast5Submission(supabase, userId, replyToken, text, state, templates);
    return;
  }

  if (state.awaiting_price_dispute_for_order_id) {
    await handlePriceDisputeSubmission(supabase, userId, replyToken, text, state.awaiting_price_dispute_for_order_id, templates);
    return;
  }

  if (state.awaiting_quantity_for_order_id) {
    const parsed = parsePositiveInteger(text);
    if (parsed === null) {
      await replyTemplate(replyToken, templates, "quantity_invalid_number");
      return;
    }
    const orderId = state.awaiting_quantity_for_order_id;
    await setBotState(supabase, userId, { awaiting_quantity_for_order_id: null });
    await applyQuantityUpdate(supabase, userId, orderId, parsed, replyToken, templates);
    return;
  }

  const keywords = await getLivestreamKeywords();

  if (matchesAny(text, keywords.done)) {
    await handleDoneCommand(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesAny(text, keywords.order)) {
    await handleOrderTrigger(supabase, userId, replyToken, templates);
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

  if (matchesAny(text, keywords.quantity_confirm)) {
    await handleQuantityConfirmTrigger(supabase, userId, replyToken, templates);
    return;
  }

  if (matchesAny(text, keywords.edit_nickname)) {
    await handleEditNicknameTrigger(supabase, userId, replyToken, templates);
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

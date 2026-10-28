import "server-only";

import { getLineUserProfile, sendLineReply, type LineReplyMessage } from "@/lib/line/client";
import { buildCuteButton, buildCuteButtonFooter } from "@/lib/line/flex-buttons";
import type { LineWebhookEvent } from "@/lib/line/livestream-orders";
import { findOrCreateMemberForLineUser } from "@/lib/line/member-binding";
import { createPreorderMagicLink } from "@/lib/line/preorder-magic-link";
import { getPreorderLinkSettings } from "@/lib/line/preorder-link-settings";
import { isMemberDisabled } from "@/lib/member/status";
import { getSiteOrigin } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 預購獨立流程 第二期：LINE webhook 的文字訊息處理。刻意跟
// src/lib/line/livestream-orders.ts（社群連線訂單既有功能，同一個
// webhook/同一個 LINE 官方帳號）完全分開寫成獨立檔案——兩個功能
// 概念上不相干，混在同一支 handleTextMessage 裡會增加互相影響的
// 風險。真正保證兩邊不互相干擾的是 src/app/api/line/webhook/route.ts
// 裡的分派順序：這支 handlePreorderLineEvent() 先判斷「這則訊息
// 是不是精確符合預購的觸發格式」，是就自己處理完、回傳 true（webhook
// route 看到 true 就不會再把這個事件丟給舊的 handleLineEvent）；不是
// 就直接回傳 false，原封不動交給舊的既有邏輯，對任何非預購訊息零影響。
//
// 調查階段已經確認既有 livestream-orders.ts 的 order 關鍵字組裡就有
// 「綁定」這個詞（子字串比對），所以這裡判斷「是不是預購訊息」用的是
// 「精確格式／完全比對」這兩種高特定性條件，不是子字串比對：
// 1. 整則訊息完全等於後台設定的回頭客關鍵字（不是 includes）
// 2. 訊息含有全形「｜」且能切成兩段，前半段（批次名稱）還要真的能在
//    product_series 表查到對應的系列才算數
// 兩者都是刻意設計成「誤判機率極低」的條件，不會隨便被一般聊天內容
// 意外觸發。
//
// 系列管理取代標籤批次機制：批次名稱直接是 product_series.name，不再
// 透過 preorder-link-batches.ts 的 batchName -> categoryId KV 對照表
// 間接查，也不再透過 product_categories 關聯表篩商品——products.series_id
// 直接外鍵指到系列，一對一查詢。

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const MAX_PRODUCTS_IN_CARD = 12;

type PreorderProductRow = {
  id: string;
  legacy_id: string | null;
  name: string;
  image_url: string | null;
  deadline: string | null;
};

// 「{批次名稱}｜{預填文案}{暱稱}」。暱稱前面如果還留著後台設定的預填
// 文案就去掉，客人如果把預填文案整段刪掉直接打暱稱，一樣能正確解析——
// 不強制要求預填文案的字一個不少地保留著。
function parseBatchLinkMessage(text: string, prefix: string): { batchName: string; nickname: string } | null {
  const parts = text.split("｜");
  if (parts.length !== 2) return null;
  const batchName = parts[0].trim();
  if (!batchName) return null;
  let rest = parts[1];
  if (prefix && rest.startsWith(prefix)) rest = rest.slice(prefix.length);
  const nickname = rest.trim();
  if (!nickname) return null;
  return { batchName, nickname };
}

async function findSeriesIdByName(service: SupabaseServiceClient, name: string): Promise<string | null> {
  const { data } = await service.from("product_series").select("id").eq("name", name).maybeSingle();
  return data?.id || null;
}

async function fetchPreorderProducts(service: SupabaseServiceClient, seriesId: string | null): Promise<PreorderProductRow[]> {
  let query = service
    .from("products")
    .select("id,legacy_id,name,image_url,deadline")
    .eq("product_type", "preorder")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(MAX_PRODUCTS_IN_CARD);

  // products.series_id 是直接外鍵，不用再像舊版那樣先查
  // product_categories 關聯表拿 product_id 清單——一對一，一次查詢就夠。
  if (seriesId) query = query.eq("series_id", seriesId);

  const { data } = await query;
  return data || [];
}

function formatDeadlineText(deadline: string | null): string {
  if (!deadline) return "結單時間未定";
  return `結單時間：${deadline}`;
}

function buildPreorderListFlex(
  products: PreorderProductRow[],
  productLink: (idOrLegacyId: string) => string,
  allLink: string,
): Record<string, unknown> {
  const rows = products.map((product) => ({
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      product.image_url
        ? { type: "image", url: product.image_url, size: "sm", aspectRatio: "1:1", aspectMode: "cover", flex: 2 }
        : { type: "box", layout: "vertical", flex: 2, contents: [] },
      {
        type: "box",
        layout: "vertical",
        flex: 5,
        justifyContent: "center",
        contents: [
          { type: "text", text: product.name, wrap: true, size: "sm", weight: "bold" },
          { type: "text", text: formatDeadlineText(product.deadline), size: "xs", color: "#999999" },
        ],
      },
      buildCuteButton(
        { key: "preorder_enter", label: "進入", action: { type: "uri", label: "進入", uri: productLink(product.legacy_id || product.id) } },
        3,
      ),
    ],
  }));

  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [{ type: "text", text: "預購清單", weight: "bold", size: "lg" }],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "lg",
      contents: rows,
    },
    footer: buildCuteButtonFooter([
      { key: "preorder_open_all", label: "開啟全部預購", action: { type: "uri", label: "開啟全部預購", uri: allLink } },
    ]),
  };
}

async function resolveNewAccountDisplayName(lineUserId: string, nickname: string | undefined): Promise<string | null> {
  if (nickname) return nickname;
  // 走「回頭客關鍵字」這條路沒有暱稱可以用——退而求其次拿 LINE 本身的
  // 顯示名稱當預設值，比完全空白好；這不是客人填的 IG/社群暱稱，單純
  // 當作沒有更好資訊時的 fallback。
  const profile = await getLineUserProfile(lineUserId);
  return profile?.displayName || null;
}

async function handlePreorderMessage(
  service: SupabaseServiceClient,
  lineUserId: string,
  replyToken: string | undefined,
  seriesId: string | null,
  nickname: string | undefined,
): Promise<void> {
  const { data: existing } = await service
    .from("member_line_accounts")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  let userId: string;
  let isNewBinding: boolean;

  if (existing?.user_id) {
    userId = existing.user_id;
    isNewBinding = false;
  } else {
    const result = await findOrCreateMemberForLineUser(service, lineUserId);
    if (!result.ok) {
      await replyMessages(replyToken, [{ type: "text", text: "系統發生問題，請稍後再試。" }]);
      return;
    }
    userId = result.userId;
    isNewBinding = true;

    const displayName = await resolveNewAccountDisplayName(lineUserId, nickname);
    if (displayName) {
      await service.from("member_profiles").upsert({ user_id: userId, display_name: displayName }, { onConflict: "user_id" });
    }
  }

  if (await isMemberDisabled(service, userId)) {
    await replyMessages(replyToken, [{ type: "text", text: "您的會員帳號目前已停用，請聯繫客服。" }]);
    return;
  }

  const products = await fetchPreorderProducts(service, seriesId);
  const origin = getSiteOrigin();
  const magicLink = (returnTo: string) =>
    `${origin}/api/line/preorder-magic-link?token=${encodeURIComponent(createPreorderMagicLink(lineUserId, returnTo))}`;
  const productLink = (idOrLegacyId: string) => magicLink(`/products/${idOrLegacyId}`);
  const allLink = magicLink("/category/preorder");

  const introText = isNewBinding ? "綁定成功！點擊以下連結開始購物。" : "歡迎回來！目前預購清單：";

  if (!products.length) {
    await replyMessages(replyToken, [{ type: "text", text: `${introText}\n目前還沒有可以預購的商品，敬請期待。` }]);
    return;
  }

  // 同一個 replyToken 只能用一次——文字提示跟 Flex 清單卡合併成同一次
  // sendLineReply() 呼叫送出兩則訊息，不要分兩次呼叫（分兩次第二次會
  // 因為 replyToken 已經用過而失敗）。
  await replyMessages(replyToken, [
    { type: "text", text: introText },
    { type: "flex", altText: "預購清單", contents: buildPreorderListFlex(products, productLink, allLink) },
  ]);
}

async function replyMessages(replyToken: string | undefined, messages: LineReplyMessage[]): Promise<void> {
  if (!replyToken) return;
  await sendLineReply(replyToken, messages);
}

// webhook route 的進入點：回傳 true 代表這則訊息是預購相關、已經處理
// 完畢；回傳 false 代表跟預購無關，呼叫端要原封不動交給既有的
// handleLineEvent（社群連線訂單功能）處理，這支函式完全不應該、也
// 沒有能力影響那條路徑。
export async function handlePreorderLineEvent(event: LineWebhookEvent): Promise<boolean> {
  if (event.type !== "message" || event.message?.type !== "text") return false;
  const lineUserId = event.source?.userId;
  if (!lineUserId || event.source?.type !== "user") return false;

  const text = String(event.message.text || "").trim();
  if (!text) return false;

  const settings = await getPreorderLinkSettings();
  const service = createSupabaseServiceClient();

  if (text === settings.returningKeyword) {
    await handlePreorderMessage(service, lineUserId, event.replyToken, null, undefined);
    return true;
  }

  const parsed = parseBatchLinkMessage(text, settings.oaMessagePrefix);
  if (parsed) {
    // 查不到對應系列（連結太舊、系列已被刪除、或這個名稱從來不是用
    // 「產生預購連結」工具產生的）就當作沒有系列，退回「全部預購
    // 清單」，不是解析失敗——使用者的訊息本身已經確定是這個格式了，
    // 不應該因為查不到系列就整個不回應。
    const seriesId = await findSeriesIdByName(service, parsed.batchName);
    await handlePreorderMessage(service, lineUserId, event.replyToken, seriesId, parsed.nickname);
    return true;
  }

  return false;
}

import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 livestream-reply-templates.ts 的 schedule_settings KV 模式（不開
// 新表、不做新機制）。這兩個文案被兩個地方用到：後台「產生預購連結」
// 工具組網址時用 oaMessagePrefix 當預填文案；LINE webhook（第二期）收到
// 文字訊息時，用這兩個值去判斷「這是不是回頭客關鍵字」跟「能不能解析出
// 批次名稱＋暱稱」——兩邊永遠要讀同一份設定，不能各自寫死一份。
const SETTINGS_TYPE = "preorder-link-settings";
const MAX_LENGTH = 200;

export type PreorderLinkSettings = {
  // 整則訊息完全比對（不是子字串），客人打這個字就等於「要看全部預購
  // 清單」，沒有批次篩選。故意用完全比對，不是像 livestream-keywords
  // 那樣子字串比對——這組字本來就不太可能跟其他功能的關鍵字撞到，完全
  // 比對又更進一步降低誤判機率。
  returningKeyword: string;
  // oaMessage 連結組網址時，{批次名稱}｜ 後面接的那段固定文案——客人
  // 點連結進 LINE 聊天室時，文字框已經預填好「{批次名稱}｜{這段文案}」，
  // 客人只要在後面補上暱稱再送出。webhook 解析訊息格式時也是拿這段
  // 文案當分隔依據，去抓客人實際輸入的暱稱是哪一段。
  oaMessagePrefix: string;
};

export const DEFAULT_PREORDER_LINK_SETTINGS: PreorderLinkSettings = {
  returningKeyword: "【查看預購新品】",
  oaMessagePrefix: "請在此輸入(ig/社群)暱稱後送出：",
};

function sanitize(input: Partial<Record<keyof PreorderLinkSettings, unknown>>): PreorderLinkSettings {
  const pick = (key: keyof PreorderLinkSettings) => {
    const value = input[key];
    return typeof value === "string" && value.trim() ? value.slice(0, MAX_LENGTH) : DEFAULT_PREORDER_LINK_SETTINGS[key];
  };
  return {
    returningKeyword: pick("returningKeyword"),
    oaMessagePrefix: pick("oaMessagePrefix"),
  };
}

export async function getPreorderLinkSettings(): Promise<PreorderLinkSettings> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return { ...DEFAULT_PREORDER_LINK_SETTINGS };
    return sanitize(JSON.parse(data.image));
  } catch {
    return { ...DEFAULT_PREORDER_LINK_SETTINGS };
  }
}

export async function savePreorderLinkSettings(
  input: Partial<Record<keyof PreorderLinkSettings, unknown>>,
): Promise<PreorderLinkSettings> {
  const current = await getPreorderLinkSettings();
  const next = sanitize({ ...current, ...input });
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(next) }, { onConflict: "type" });
  if (error) throw error;
  return next;
}

import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 四組觸發關鍵字改成後台可設定 (schedule_settings KV，比照
// livestream-bank-info.ts 的模式，不開新表)。讀取失敗或還沒設定過時，
// 一律 fallback 回這裡的預設值——所以即使從未進過後台設定畫面，bot 的
// 行為也跟改動前完全一樣，不會突然失效。
//
// 原本的「完成」(好了) 跟「數量確認」(數量正確) 兩組關鍵字曾經整組
// 移除過——客人端數量/價格互動整組拿掉後，那兩個觸發詞一度失去意義。
// 這次新增的 photo_confirm 組（預設「傳好了」）雖然詞面類似，但語意
// 完全不同：不是回傳數量確認清單，純粹是「查一下最近 10 分鐘內有沒有
// 收到照片」的一句文字回覆，見 livestream-orders.ts::handlePhotoConfirmTrigger。
const SETTINGS_TYPE = "community-livestream-keywords";
const MAX_KEYWORDS_PER_GROUP = 30;
const MAX_KEYWORD_LENGTH = 40;

export type LivestreamKeywordGroup = "order" | "remittance" | "cancel" | "photo_confirm";

export const LIVESTREAM_KEYWORD_GROUPS: LivestreamKeywordGroup[] = ["order", "remittance", "cancel", "photo_confirm"];

export const LIVESTREAM_KEYWORD_GROUP_LABELS: Record<LivestreamKeywordGroup, string> = {
  order: "下單觸發詞",
  remittance: "匯款觸發詞",
  cancel: "取消觸發詞",
  photo_confirm: "傳照片確認觸發詞",
};

export const DEFAULT_LIVESTREAM_KEYWORDS: Record<LivestreamKeywordGroup, string[]> = {
  order: ["我要下單", "下單", "開始下單", "開通", "綁定", "加入社群", "註冊"],
  remittance: ["我要匯款", "匯款申報", "回報匯款", "匯款"],
  cancel: ["取消訂單", "我要取消", "取消"],
  photo_confirm: ["傳好了", "好了", "傳完了", "完成"],
};

export type LivestreamKeywords = Record<LivestreamKeywordGroup, string[]>;

function sanitizeGroup(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS_PER_GROUP)
    .map((item) => item.slice(0, MAX_KEYWORD_LENGTH));
  return cleaned.length ? cleaned : fallback;
}

function sanitizeAllGroups(input: Partial<Record<LivestreamKeywordGroup, unknown>>): LivestreamKeywords {
  const result = {} as LivestreamKeywords;
  LIVESTREAM_KEYWORD_GROUPS.forEach((group) => {
    result[group] = sanitizeGroup(input[group], DEFAULT_LIVESTREAM_KEYWORDS[group]);
  });
  return result;
}

export async function getLivestreamKeywords(): Promise<LivestreamKeywords> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return { ...DEFAULT_LIVESTREAM_KEYWORDS };
    const parsed = JSON.parse(data.image) as Partial<Record<LivestreamKeywordGroup, unknown>>;
    return sanitizeAllGroups(parsed);
  } catch {
    return { ...DEFAULT_LIVESTREAM_KEYWORDS };
  }
}

export async function saveLivestreamKeywords(next: LivestreamKeywords): Promise<LivestreamKeywords> {
  const sanitized = sanitizeAllGroups(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(sanitized) }, { onConflict: "type" });
  if (error) throw error;
  return sanitized;
}

export type LivestreamKeywordDuplicate = { keyword: string; groups: LivestreamKeywordGroup[] };

// 存檔時偵測「完全重複」的詞出現在不只一組裡——不是強制擋下，只是給
// 管理員一個提示，因為 bot 判斷觸發詞是照固定順序（下單→匯款→取消→
// 傳照片確認）一組一組比對，同一個詞如果放進兩組，後面那組永遠不會
// 被命中。
export function findDuplicateKeywords(groups: LivestreamKeywords): LivestreamKeywordDuplicate[] {
  const seen = new Map<string, Set<LivestreamKeywordGroup>>();
  LIVESTREAM_KEYWORD_GROUPS.forEach((group) => {
    (groups[group] || []).forEach((raw) => {
      const key = raw.trim().toLowerCase();
      if (!key) return;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(group);
    });
  });
  const duplicates: LivestreamKeywordDuplicate[] = [];
  seen.forEach((groupSet, keyword) => {
    if (groupSet.size > 1) duplicates.push({ keyword, groups: [...groupSet] });
  });
  return duplicates;
}

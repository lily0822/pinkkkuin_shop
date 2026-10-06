import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 五組觸發關鍵字改成後台可設定 (schedule_settings KV，比照
// livestream-bank-info.ts 的模式，不開新表)。讀取失敗或還沒設定過時，
// 一律 fallback 回這裡的預設值——所以即使從未進過後台設定畫面，bot 的
// 行為也跟改動前完全一樣，不會突然失效。
//
// 原本的「完成」(好了) 跟「數量確認」(數量正確) 兩組關鍵字曾經整組
// 移除過——客人端數量/價格互動整組拿掉後，那兩個觸發詞一度失去意義。
// 之後新增的 photo_confirm 組（預設「傳好了」）雖然詞面類似，但語意
// 完全不同：不是回傳數量確認清單，純粹是「查一下最近 10 分鐘內有沒有
// 收到照片」的一句文字回覆，見 livestream-orders.ts::handlePhotoConfirmTrigger。
//
// remittance_cancel（預設「取消匯款」）是給卡在 awaiting_remittance_last5
// 等待狀態的客人用的明確逃生指令——見 livestream-orders.ts::
// handleTextMessage 開頭那段「等待匯款格式時優先比對其他已知指令」的
// 說明，這組關鍵字只在那個等待狀態下才有意義，不在一般對話觸發。
//
// order_query（預設「查詢訂單」）是獨立的一組——**上一輪曾經誤把它當成
// cancel 組的同義詞**（純粹多一種方式叫出取消清單），這輪拆開成真正
// 獨立的功能：查詢訂單不篩選任何狀態、列出客人全部商品，純展示沒有
// 取消按鈕；取消訂單維持原本只篩可取消子集 + 取消按鈕。兩組關鍵字
// 完全不重疊，見 livestream-orders.ts 功能六/功能七。
//
// 每組新增「啟用/停用」開關（this round）：schedule_settings 存的 JSON
// 從單純 Record<group, string[]> 改成 { groups, enabled } 兩個子物件。
// 相容舊資料——讀取時如果解析出來的 JSON 沒有 groups/enabled 這兩個
// key（舊格式，整包本身就是 Record<group,string[]>），就把整包當成
// groups，enabled 全部預設 true，行為跟改版前完全一樣。停用只影響
// 「客人端會不會觸發」（見 livestream-orders.ts::handleTextMessage），
// 不影響後台能不能照常編輯詞庫內容。
const SETTINGS_TYPE = "community-livestream-keywords";
const MAX_KEYWORDS_PER_GROUP = 30;
const MAX_KEYWORD_LENGTH = 40;

export type LivestreamKeywordGroup =
  | "order"
  | "remittance"
  | "cancel"
  | "order_query"
  | "photo_confirm"
  | "remittance_cancel";

export const LIVESTREAM_KEYWORD_GROUPS: LivestreamKeywordGroup[] = [
  "order",
  "remittance",
  "cancel",
  "order_query",
  "photo_confirm",
  "remittance_cancel",
];

export const LIVESTREAM_KEYWORD_GROUP_LABELS: Record<LivestreamKeywordGroup, string> = {
  order: "下單觸發詞",
  remittance: "匯款觸發詞",
  cancel: "取消觸發詞",
  order_query: "查詢訂單觸發詞",
  photo_confirm: "傳照片確認觸發詞",
  remittance_cancel: "取消匯款觸發詞",
};

export const DEFAULT_LIVESTREAM_KEYWORDS: Record<LivestreamKeywordGroup, string[]> = {
  order: ["我要下單", "下單", "開始下單", "開通", "綁定", "加入社群", "註冊"],
  remittance: ["我要匯款", "匯款申報", "回報匯款", "匯款"],
  cancel: ["取消訂單", "我要取消", "取消"],
  order_query: ["查詢訂單"],
  photo_confirm: ["傳好了", "好了", "傳完了", "完成"],
  remittance_cancel: ["取消匯款"],
};

export type LivestreamKeywords = Record<LivestreamKeywordGroup, string[]>;

export type LivestreamKeywordEnabled = Record<LivestreamKeywordGroup, boolean>;

export const DEFAULT_LIVESTREAM_KEYWORD_ENABLED: LivestreamKeywordEnabled = {
  order: true,
  remittance: true,
  cancel: true,
  order_query: true,
  photo_confirm: true,
  remittance_cancel: true,
};

export type LivestreamKeywordSettings = {
  keywords: LivestreamKeywords;
  enabled: LivestreamKeywordEnabled;
};

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

// 只接受 boolean——缺漏或型別不對的組別預設 true（啟用），跟「還沒
// 存過 enabled 欄位」的舊資料走的是同一條 fallback 路徑，不用另外
// 判斷資料是不是舊格式。
function sanitizeEnabled(input: unknown): LivestreamKeywordEnabled {
  const record = input && typeof input === "object" ? (input as Partial<Record<LivestreamKeywordGroup, unknown>>) : {};
  const result = {} as LivestreamKeywordEnabled;
  LIVESTREAM_KEYWORD_GROUPS.forEach((group) => {
    result[group] = typeof record[group] === "boolean" ? record[group] : true;
  });
  return result;
}

function defaultSettings(): LivestreamKeywordSettings {
  return { keywords: { ...DEFAULT_LIVESTREAM_KEYWORDS }, enabled: { ...DEFAULT_LIVESTREAM_KEYWORD_ENABLED } };
}

// 新舊格式都在這裡判斷：新格式是 { groups, enabled } 兩個子物件；舊
// 格式整包本身就是 Record<group, string[]>，沒有 groups/enabled 這兩個
// key。用「有沒有其中一個 key」判斷，不要求兩個都要有——哪天只想先加
// enabled、暫不動 groups 的寫法也能正確辨識成新格式。
function parseStoredSettings(raw: string): LivestreamKeywordSettings {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === "object" && ("groups" in parsed || "enabled" in parsed)) {
    const record = parsed as { groups?: unknown; enabled?: unknown };
    const groupsInput = record.groups && typeof record.groups === "object" ? (record.groups as Partial<Record<LivestreamKeywordGroup, unknown>>) : {};
    return {
      keywords: sanitizeAllGroups(groupsInput),
      enabled: sanitizeEnabled(record.enabled),
    };
  }
  return {
    keywords: sanitizeAllGroups(parsed as Partial<Record<LivestreamKeywordGroup, unknown>>),
    enabled: { ...DEFAULT_LIVESTREAM_KEYWORD_ENABLED },
  };
}

// 一次讀取就拿到 keywords + enabled，不分兩次查 schedule_settings。
export async function getLivestreamKeywordSettings(): Promise<LivestreamKeywordSettings> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return defaultSettings();
    return parseStoredSettings(data.image);
  } catch {
    return defaultSettings();
  }
}

export async function saveLivestreamKeywords(
  nextKeywords: Partial<Record<LivestreamKeywordGroup, unknown>>,
  nextEnabled: Partial<Record<LivestreamKeywordGroup, unknown>>,
): Promise<LivestreamKeywordSettings> {
  const sanitizedKeywords = sanitizeAllGroups(nextKeywords);
  const sanitizedEnabled = sanitizeEnabled(nextEnabled);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert(
      { legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify({ groups: sanitizedKeywords, enabled: sanitizedEnabled }) },
      { onConflict: "type" },
    );
  if (error) throw error;
  return { keywords: sanitizedKeywords, enabled: sanitizedEnabled };
}

export type LivestreamKeywordDuplicate = { keyword: string; groups: LivestreamKeywordGroup[] };

// 存檔時偵測「完全重複」的詞出現在不只一組裡——不是強制擋下，只是給
// 管理員一個提示，因為 bot 判斷觸發詞是照固定順序（下單→匯款→取消→
// 查詢訂單→傳照片確認→取消匯款）一組一組比對，同一個詞如果放進兩組，
// 後面那組永遠不會被命中。跟「啟用/停用」無關——即使停用的那組被
// 停用了，重複偵測仍然原樣比對，純粹是提醒詞庫本身的重疊，不是提醒
// 實際會不會觸發。
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

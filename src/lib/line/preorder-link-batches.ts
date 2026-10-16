import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 後台「產生預購連結」工具跟 webhook 解析共用的 batchName -> categoryId
// 對應表。batchName 是管理員自己打的這批顯示名稱（例如「2027年2月
// 大耳狗」），刻意跟標籤本身的 categories.name 分開——同一個標籤（例如
// 「大耳狗」）可能被很多次不同批次重複使用，各批次需要自己的可識別
// 名稱，不能直接拿標籤名字去反查。webhook 收到客人訊息解析出批次名稱
// 後查的是這份清單，不是 categories 表本身。比照
// livestream-reply-templates.ts 的 schedule_settings KV 模式，不開新表。
const SETTINGS_TYPE = "preorder-link-batches";
const MAX_BATCHES = 500; // 防止這份清單無限制長大，超過上限自動丟掉最舊的

export type PreorderLinkBatch = {
  batchName: string;
  categoryId: string;
  createdAt: string;
};

function sanitizeBatches(input: unknown): PreorderLinkBatch[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const record = item as Record<string, unknown>;
      const batchName = String(record.batchName || "").trim();
      const categoryId = String(record.categoryId || "").trim();
      if (!batchName || !categoryId) return null;
      return {
        batchName,
        categoryId,
        createdAt: String(record.createdAt || "") || new Date().toISOString(),
      };
    })
    .filter((item): item is PreorderLinkBatch => Boolean(item));
}

export async function getPreorderLinkBatches(): Promise<PreorderLinkBatch[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("image")
      .eq("type", SETTINGS_TYPE)
      .maybeSingle();
    if (error || !data?.image) return [];
    return sanitizeBatches(JSON.parse(data.image));
  } catch {
    return [];
  }
}

export async function findCategoryIdByBatchName(batchName: string): Promise<string | null> {
  const batches = await getPreorderLinkBatches();
  const match = batches.find((batch) => batch.batchName === batchName);
  return match?.categoryId || null;
}

// 以 batchName 為鍵 upsert——重新產生同一個顯示名稱的連結時，更新它
// 指到哪個標籤，不會一直往陣列裡加新的一筆。
export async function saveLinkBatch(batchName: string, categoryId: string): Promise<PreorderLinkBatch[]> {
  const trimmedName = batchName.trim();
  if (!trimmedName) throw new Error("批次顯示名稱不可為空。");
  if (trimmedName.includes("｜")) throw new Error("批次顯示名稱不能包含「｜」符號（這個符號是訊息格式的分隔符）。");

  const current = await getPreorderLinkBatches();
  const withoutExisting = current.filter((batch) => batch.batchName !== trimmedName);
  const next = [...withoutExisting, { batchName: trimmedName, categoryId, createdAt: new Date().toISOString() }].slice(-MAX_BATCHES);

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("schedule_settings")
    .upsert({ legacy_id: SETTINGS_TYPE, type: SETTINGS_TYPE, image: JSON.stringify(next) }, { onConflict: "type" });
  if (error) throw error;
  return next;
}

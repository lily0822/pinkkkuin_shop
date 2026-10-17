import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 預購系列管理：取代上一輪 preorder-link-batches.ts 的 batchName ->
// categoryId KV 對照表——這是一張真正的表，id 就是真的 Supabase uuid，
// 不像 categories 那樣需要 legacy_id 轉換（這張表是這次新建的，沒有舊的
// Apps Script/Google Sheet 系統在同步它）。
//
// IP 標籤改掛在系列身上（這輪新增）：ipTagIds 存的是後台畫面上看到的
// 標籤 id，也就是 categories.legacy_id（比照 category-sync.ts 的
// mapCategoryRow 慣例——後台畫面上的標籤 id 一律是 legacy_id || id，
// 不是真正的 Supabase uuid），存進 series_categories 前要先解析回真正
// 的 categories.id，跟 product-sync.ts 的 resolveCategoryIds 是同一套
// 邏輯，這裡沒有共用那支函式，單純因為兩邊模組目前沒有互相依賴、各自
// 一份比共用一個小工具函式更不容易在其中一邊改動時誤傷另一邊。

export type BackendSeriesPayload = {
  id?: string;
  name: string;
  coverImageUrl?: string;
  sortOrder?: number;
  ipTagIds?: (string | number)[];
};

export type BackendSeries = {
  id: string;
  name: string;
  coverImageUrl: string;
  sortOrder: number;
  productCount: number;
  ipTagIds: string[];
  createdAt: string;
};

type RawSeriesRow = {
  id: string;
  name: string | null;
  cover_image_url: string | null;
  sort_order: number | null;
  created_at: string | null;
  products?: Array<{ count: number }> | null;
  series_categories?: Array<{ categories?: { id?: string | null; legacy_id?: string | null } | null }> | null;
};

function mapSeriesRow(row: RawSeriesRow): BackendSeries {
  const ipTagIds = (row.series_categories || [])
    .map((link) => link.categories)
    .filter((category): category is NonNullable<typeof category> => !!category)
    .map((category) => String(category.legacy_id || category.id));
  return {
    id: row.id,
    name: row.name || "",
    coverImageUrl: row.cover_image_url || "",
    sortOrder: Number(row.sort_order ?? 0),
    productCount: Number(row.products?.[0]?.count ?? 0),
    ipTagIds,
    createdAt: row.created_at || "",
  };
}

const SERIES_SELECT = "id,name,cover_image_url,sort_order,created_at,products(count),series_categories(categories(id,legacy_id))";
// series_categories（202610190001）還沒套用到這個環境時，上面這層帶
// embed 的 select 會整個查詢失敗（PostgREST 連這個關聯都找不到，不是
// 回空陣列）——退回沒有這個 embed 的版本，讓「預購系列管理」列表這個
// 既有功能不會被這次新增的 IP 關聯拖垮，只是 ipTagIds 暫時都是空陣列。
const SERIES_SELECT_LEGACY = "id,name,cover_image_url,sort_order,created_at,products(count)";

function isMissingRelationError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST200" || error?.code === "42P01";
}

export async function listBackendSeries(): Promise<BackendSeries[]> {
  const supabase = createSupabaseServiceClient();
  for (const select of [SERIES_SELECT, SERIES_SELECT_LEGACY]) {
    const { data, error } = await supabase
      .from("product_series")
      .select(select)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<RawSeriesRow[]>();
    if (!error) return (data || []).map(mapSeriesRow);
    if (!isMissingRelationError(error)) throw error;
  }
  return [];
}

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function resolveIpCategoryIds(supabase: SupabaseServiceClient, tagIds: (string | number)[]): Promise<string[]> {
  if (!tagIds.length) return [];
  const legacyIds = tagIds.map((tagId) => String(tagId));
  const { data } = await supabase.from("categories").select("id,legacy_id").eq("type", "ip").in("legacy_id", legacyIds);
  return (data || []).map((row) => row.id);
}

// series_categories（202610190001）還沒套用到這個環境時，這整段會因為
// 表不存在而失敗——吞掉這個情況（只記 log），不要讓「系列基本資料
// （名稱/主圖/排序）存檔」這個既有功能被這次新增的 IP 關聯拖垮，使用者
// 這次選的 IP 會暫時存不進去，但其他欄位照常正常儲存。
async function syncSeriesCategories(supabase: SupabaseServiceClient, seriesId: string, tagIds: (string | number)[]) {
  const { error: deleteError } = await supabase.from("series_categories").delete().eq("series_id", seriesId);
  if (deleteError) {
    if (isMissingRelationError(deleteError) || deleteError.code === "42703") {
      console.warn("series_categories table not available yet, skipping IP tag sync for series", seriesId);
      return;
    }
    throw deleteError;
  }
  const categoryIds = await resolveIpCategoryIds(supabase, tagIds || []);
  if (!categoryIds.length) return;
  const { error: insertError } = await supabase
    .from("series_categories")
    .insert(categoryIds.map((categoryId) => ({ series_id: seriesId, category_id: categoryId })));
  if (insertError) throw insertError;
}

// 新增／編輯：有 id 就 update，沒有就 insert。name 在資料庫層級是
// unique（記事本連結的批次識別依據，不能重複），這裡先把 Postgres 的
// unique violation（23505）轉成中文訊息，不要讓使用者看到原始錯誤碼。
export async function saveBackendSeries(payload: BackendSeriesPayload): Promise<BackendSeries> {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("系列名稱不可為空。");
  if (name.includes("｜")) throw new Error("系列名稱不能包含「｜」符號（這個符號是 LINE 訊息格式的分隔符）。");

  const supabase = createSupabaseServiceClient();
  const row = {
    name,
    cover_image_url: payload.coverImageUrl || "",
    sort_order: Number(payload.sortOrder || 0),
  };

  const query = payload.id
    ? supabase.from("product_series").update(row).eq("id", payload.id)
    : supabase.from("product_series").insert(row);

  const { data, error } = await query.select("id,name,cover_image_url,sort_order,created_at").limit(1);
  if (error) {
    if (error.code === "23505") throw new Error("這個系列名稱已經存在，請換一個名稱。");
    throw error;
  }
  if (!data?.[0]) throw new Error("系列儲存未回傳資料。");
  const savedId = data[0].id as string;

  const ipTagIds = Array.isArray(payload.ipTagIds) ? payload.ipTagIds : [];
  await syncSeriesCategories(supabase, savedId, ipTagIds);

  for (const select of [SERIES_SELECT, SERIES_SELECT_LEGACY]) {
    const { data: refreshed, error: refreshError } = await supabase
      .from("product_series")
      .select(select)
      .eq("id", savedId)
      .returns<RawSeriesRow[]>()
      .limit(1);
    if (!refreshError) {
      if (!refreshed?.[0]) throw new Error("系列儲存未回傳資料。");
      return mapSeriesRow(refreshed[0]);
    }
    if (!isMissingRelationError(refreshError)) throw refreshError;
  }
  throw new Error("系列儲存未回傳資料。");
}

export class SeriesInUseError extends Error {}

export async function deleteBackendSeries(id: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { count, error: countError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("series_id", id);
  if (countError) throw countError;
  if (count && count > 0) {
    throw new SeriesInUseError(`這個系列底下還有 ${count} 件商品，請先把商品改到其他系列或刪除，才能刪除這個系列。`);
  }

  // series_categories 的 series_id 是 on delete cascade，不需要先手動
  // 清——刪除系列本身會自動帶走底下的 IP 關聯列。
  const { error } = await supabase.from("product_series").delete().eq("id", id);
  if (error) throw error;
}

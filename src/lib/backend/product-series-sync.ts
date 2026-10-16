import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 預購系列管理：取代上一輪 preorder-link-batches.ts 的 batchName ->
// categoryId KV 對照表——這是一張真正的表，id 就是真的 Supabase uuid，
// 不像 categories 那樣需要 legacy_id 轉換（這張表是這次新建的，沒有舊的
// Apps Script/Google Sheet 系統在同步它）。

export type BackendSeriesPayload = {
  id?: string;
  name: string;
  coverImageUrl?: string;
  sortOrder?: number;
};

export type BackendSeries = {
  id: string;
  name: string;
  coverImageUrl: string;
  sortOrder: number;
  productCount: number;
  createdAt: string;
};

type RawSeriesRow = {
  id: string;
  name: string | null;
  cover_image_url: string | null;
  sort_order: number | null;
  created_at: string | null;
  products?: Array<{ count: number }> | null;
};

function mapSeriesRow(row: RawSeriesRow): BackendSeries {
  return {
    id: row.id,
    name: row.name || "",
    coverImageUrl: row.cover_image_url || "",
    sortOrder: Number(row.sort_order ?? 0),
    productCount: Number(row.products?.[0]?.count ?? 0),
    createdAt: row.created_at || "",
  };
}

export async function listBackendSeries(): Promise<BackendSeries[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_series")
    .select("id,name,cover_image_url,sort_order,created_at,products(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<RawSeriesRow[]>();
  if (error) throw error;
  return (data || []).map(mapSeriesRow);
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
  return mapSeriesRow(data[0]);
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

  const { error } = await supabase.from("product_series").delete().eq("id", id);
  if (error) throw error;
}

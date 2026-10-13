import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡 syncSupabaseCategory/
// deleteSupabaseCategory/readSupabaseCategories 的邏輯原樣搬過來——商品標籤
// 管理（IP/商品類別兩種 type）原本就已經透過 Apps Script 的
// safeSupabaseMirror 持續同步進這張既有的 categories 表（跟商品篩選/
// storefront 共用的同一張表，不是新表），這次只是把「後台存檔」這個動作
// 也改接過去，不是從頭搬資料。

export type BackendCategoryType = "ip" | "category";

export type BackendCategoryPayload = {
  id?: string | number;
  name: string;
  type?: string;
  enabled?: boolean;
  sortOrder?: number;
  color?: string;
};

export type BackendCategory = {
  id: string;
  name: string;
  type: BackendCategoryType;
  enabled: boolean;
  sortOrder: number;
  color: string;
  createdAt: string;
  updatedAt: string;
};

type RawCategoryRow = {
  id: string;
  legacy_id: string | null;
  name: string | null;
  type: string | null;
  enabled: boolean | null;
  sort_order: number | null;
  color: string | null;
  created_at: string | null;
  updated_at: string | null;
};

// 比照 .gs 的 slugify：中英數字以外一律轉成連字號，沒有任何可用字元時
// 用 category-<timestamp> 保底，避免 slug 欄位的 unique 限制炸掉。
function slugify(value: string): string {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9一-龥]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `category-${Date.now()}`;
}

function mapCategoryRow(row: RawCategoryRow, index: number): BackendCategory {
  return {
    id: String(row.legacy_id || row.id),
    name: row.name || "",
    type: row.type === "ip" ? "ip" : "category",
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order ?? index),
    color: row.color || "#ec4899",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function listBackendCategories(): Promise<BackendCategory[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id,legacy_id,name,type,enabled,sort_order,color,created_at,updated_at")
    .order("type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((row, index) => mapCategoryRow(row, index));
}

// 比照 .gs 的 syncSupabaseCategory：用 legacy_id 或 slug 任一個對上既有列
// 就當作更新，兩個都對不上才新增——商品標籤管理頁面本來就是「整份
// 列表存檔」，同一個名稱重複送出不該變成兩筆。
export async function saveBackendCategory(tag: BackendCategoryPayload): Promise<BackendCategory> {
  if (!tag || !tag.name) throw new Error("標籤名稱不可為空。");

  const legacyId = String(tag.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const slug = slugify(tag.name);
  const incomingType = tag.type === "ip" || tag.type === "category" ? tag.type : "";
  const hasEnabled = Object.prototype.hasOwnProperty.call(tag, "enabled");
  const hasSortOrder = Object.prototype.hasOwnProperty.call(tag, "sortOrder");

  const supabase = createSupabaseServiceClient();
  const { data: existingRows } = await supabase
    .from("categories")
    .select("id,legacy_id,type,enabled,sort_order")
    .or(`legacy_id.eq.${legacyId},slug.eq.${slug}`)
    .limit(1);
  const existingRow = existingRows?.[0];

  const payload = {
    legacy_id: legacyId,
    name: String(tag.name),
    slug,
    color: tag.color || "",
    type: incomingType || existingRow?.type || "category",
    enabled: hasEnabled ? tag.enabled !== false : existingRow ? existingRow.enabled !== false : true,
    sort_order: hasSortOrder ? Number(tag.sortOrder || 0) : Number(existingRow?.sort_order || 0),
  };

  if (existingRow?.id) {
    const { data: updated, error } = await supabase
      .from("categories")
      .update(payload)
      .eq("id", existingRow.id)
      .select("id,legacy_id,name,type,enabled,sort_order,color,created_at,updated_at")
      .limit(1);
    if (error) throw error;
    if (updated?.[0]) return mapCategoryRow(updated[0], 0);
  }

  const { data: inserted, error } = await supabase
    .from("categories")
    .upsert(payload, { onConflict: "legacy_id" })
    .select("id,legacy_id,name,type,enabled,sort_order,color,created_at,updated_at")
    .limit(1);
  if (error) throw error;
  if (!inserted?.[0]) throw new Error("Supabase 標籤儲存未回傳資料。");
  return mapCategoryRow(inserted[0], 0);
}

export async function deleteBackendCategory(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("categories").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}

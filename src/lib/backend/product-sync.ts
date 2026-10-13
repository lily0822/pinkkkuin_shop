import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡 syncSupabaseProduct/
// deleteSupabaseProduct/getProductVariantsForSupabase/supabaseStatus 的邏輯
// 原樣搬過來，只是從 Apps Script + 自組 REST request 換成直接用
// @supabase/supabase-js 的 service role client。欄位對應、預設值、刪除後
// 重建分類/規格/圖片的流程刻意保持跟原本一致，降低遷移風險。
//
// 跟原本不一樣的地方：
// 1. deleteBackendProduct 這次補上 product_type 篩選——原本
//    deleteSupabaseProduct(id) 只靠 legacy_id 比對，沒有限定類型，如果
//    現貨跟預購曾經撞過同一個 id（兩邊各自用 Date.now()-ish 產生 id）
//    刪一邊會連帶刪到另一邊，這次順手補上這個安全檢查。
// 2. 找不到對應分類（categories.legacy_id）時直接略過該分類，不會像
//    Apps Script 那樣退回去讀 Google Sheet 補建——商品標籤管理這次沒有
//    搬過來，還是走舊的 Apps Script 流程，Supabase 的 categories 表本來
//    就會持續被那條既有路徑同步，這裡只需要查得到就好。

export type BackendProductType = "stock" | "preorder";

type BackendImageInput = {
  url?: string;
  publicId?: string;
  public_id?: string;
  isPrimary?: boolean;
  is_primary?: boolean;
  sortOrder?: number;
  sort_order?: number;
};

type BackendVariantInput = {
  id?: string | number;
  sku?: string;
  spec?: string;
  name?: string;
  price?: number;
  quantity?: number;
  qty?: number;
  link?: string;
  product_url?: string;
};

export type BackendProductPayload = {
  id?: string | number;
  name: string;
  description?: string;
  image?: string;
  images?: BackendImageInput[] | string;
  costPrice?: number;
  listPrice?: number;
  quantity?: number;
  quota?: number;
  deadline?: string;
  active?: boolean;
  tagIds?: (string | number)[];
  variantsJson?: string;
  variants?: BackendVariantInput[];
};

export type BackendProductSaveResult = {
  ok: true;
  productType: BackendProductType;
  legacyId: string;
  savedId: string;
};

function parseJsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function supabaseStatus(active: unknown, quantity: number): "draft" | "sold_out" | "active" {
  if (active === false || active === "false" || active === "FALSE" || active === "0" || active === "下架") return "draft";
  if (Number(quantity || 0) <= 0) return "sold_out";
  return "active";
}

function getQuantity(product: BackendProductPayload, productType: BackendProductType): number {
  return productType === "stock" ? Number(product.quantity || 0) : Number(product.quota || 0);
}

function getVariantsForSupabase(product: BackendProductPayload, productType: BackendProductType, legacyId: string) {
  const qty = getQuantity(product, productType);
  let raw = Array.isArray(product.variants) ? product.variants : parseJsonArray<BackendVariantInput>(product.variantsJson);
  if (!raw.length) {
    raw = [{ id: `${legacyId}-1`, spec: "預設款", price: Number(product.listPrice || 0), quantity: qty, link: "" }];
  }
  return raw.map((variant, index) => {
    const stockQuantity = Number(variant.quantity ?? variant.qty ?? 0);
    return {
      legacy_id: String(variant.id || `${legacyId}-${index + 1}`),
      sku: String(variant.sku || ""),
      spec: String(variant.spec || variant.name || "預設款").trim() || "預設款",
      price: Number(variant.price ?? product.listPrice ?? 0),
      stock_quantity: stockQuantity,
      product_url: String(variant.link || variant.product_url || ""),
      status: supabaseStatus(product.active, stockQuantity),
      sort_order: index,
    };
  });
}

function getImagesForSupabase(product: BackendProductPayload) {
  const rawImages = Array.isArray(product.images) ? product.images : parseJsonArray<BackendImageInput>(product.images);
  return rawImages
    .map((image, index) => ({
      publicId: String(image.publicId || image.public_id || ""),
      url: String(image.url || ""),
      isPrimary: image.isPrimary === true || image.is_primary === true,
      sortOrder: Number(image.sortOrder ?? image.sort_order ?? index),
    }))
    .filter((image) => image.publicId && image.url);
}

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function resolveCategoryIds(supabase: SupabaseServiceClient, tagIds: (string | number)[]): Promise<string[]> {
  if (!tagIds.length) return [];
  const legacyIds = tagIds.map((tagId) => String(tagId));
  const { data } = await supabase.from("categories").select("id,legacy_id").in("legacy_id", legacyIds);
  return (data || []).map((row) => row.id);
}

async function syncProductCategories(supabase: SupabaseServiceClient, productId: string, tagIds: (string | number)[]) {
  await supabase.from("product_categories").delete().eq("product_id", productId);
  const categoryIds = await resolveCategoryIds(supabase, tagIds || []);
  if (!categoryIds.length) return;
  await supabase.from("product_categories").insert(categoryIds.map((categoryId) => ({ product_id: productId, category_id: categoryId })));
}

async function syncProductVariants(
  supabase: SupabaseServiceClient,
  productId: string,
  product: BackendProductPayload,
  productType: BackendProductType,
  legacyId: string,
) {
  await supabase.from("product_variants").delete().eq("product_id", productId);
  const variants = getVariantsForSupabase(product, productType, legacyId).map((variant) => ({ ...variant, product_id: productId }));
  if (variants.length) await supabase.from("product_variants").insert(variants);
}

async function syncProductImages(supabase: SupabaseServiceClient, productId: string, product: BackendProductPayload) {
  await supabase.from("product_images").delete().eq("product_id", productId);
  const images = getImagesForSupabase(product);
  if (!images.length) return;
  await supabase.from("product_images").insert(
    images.map((image, index) => ({
      product_id: productId,
      public_id: image.publicId,
      secure_url: image.url,
      alt_text: product.name || "",
      sort_order: index,
      is_primary: image.isPrimary === true,
    })),
  );
}

export async function saveBackendProduct(
  productType: BackendProductType,
  product: BackendProductPayload,
): Promise<BackendProductSaveResult> {
  if (!product || !product.name) throw new Error("商品名稱不可為空。");

  const legacyId = String(product.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const qty = getQuantity(product, productType);

  const supabase = createSupabaseServiceClient();
  const productPayload = {
    legacy_id: legacyId,
    product_type: productType,
    name: String(product.name),
    description: product.description || "",
    image_url: product.image || "",
    cost_price: Number(product.costPrice || 0),
    base_price: Number(product.listPrice || 0),
    stock_quantity: productType === "stock" ? qty : 0,
    preorder_quota: productType === "preorder" ? qty : null,
    deadline: productType === "preorder" && product.deadline ? product.deadline : null,
    status: supabaseStatus(product.active, qty),
    source: "backend_admin",
  };

  const { data: rows, error } = await supabase
    .from("products")
    .upsert(productPayload, { onConflict: "legacy_id" })
    .select("id")
    .limit(1);
  if (error) throw error;

  let savedId = rows?.[0]?.id as string | undefined;
  if (!savedId) {
    const { data: existing } = await supabase.from("products").select("id").eq("legacy_id", legacyId).maybeSingle();
    savedId = existing?.id;
  }
  if (!savedId) throw new Error("Supabase 商品儲存未回傳 id。");

  // 分類/規格/圖片三個同步步驟都只依賴 savedId，彼此不互相依賴，平行處理；
  // 每個步驟內部「先刪除、再查詢/新增」的順序不能動（同一份資源的刪除/
  // 新增本來就要照順序），這裡平行化的是「三個不同資源之間」的部分。
  const tagIds = Array.isArray(product.tagIds) ? product.tagIds : parseJsonArray<string | number>(product.tagIds);
  await Promise.all([
    syncProductCategories(supabase, savedId, tagIds),
    syncProductVariants(supabase, savedId, product, productType, legacyId),
    syncProductImages(supabase, savedId, product),
  ]);

  return { ok: true, productType, legacyId, savedId };
}

export async function deleteBackendProduct(productType: BackendProductType, legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("products").delete().eq("legacy_id", legacyId).eq("product_type", productType);
  if (error) throw error;
}

export type BackendProductBatchItemResult = { legacyId: string; ok: boolean; error?: string };

// 批次場景（10 筆以上很常見）如果真的全部平行送出，瞬間會對 Supabase
// 開出大量連線；用一個小小的併發池限制同時處理筆數，筆數之間還是平行，
// 只是不會無限制地一次全上。5 是隨便挑的保守值，不是使用者指定的。
const BATCH_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// 批次存檔：只在呼叫端（API route）驗證一次身份/流量限制，這裡只負責
// 把每一筆商品平行處理、個別回報成功/失敗，一筆失敗不影響其他筆。
export async function saveBackendProductsBatch(
  productType: BackendProductType,
  products: BackendProductPayload[],
): Promise<BackendProductBatchItemResult[]> {
  return mapWithConcurrency(products, BATCH_CONCURRENCY, async (product) => {
    const fallbackLegacyId = String(product?.id ?? "");
    try {
      const saved = await saveBackendProduct(productType, product);
      return { legacyId: saved.legacyId, ok: true };
    } catch (error) {
      return { legacyId: fallbackLegacyId, ok: false, error: error instanceof Error ? error.message : "商品儲存失敗。" };
    }
  });
}

export async function deleteBackendProductsBatch(
  productType: BackendProductType,
  legacyIds: string[],
): Promise<BackendProductBatchItemResult[]> {
  return mapWithConcurrency(legacyIds, BATCH_CONCURRENCY, async (legacyId) => {
    try {
      await deleteBackendProduct(productType, legacyId);
      return { legacyId, ok: true };
    } catch (error) {
      return { legacyId, ok: false, error: error instanceof Error ? error.message : "商品刪除失敗。" };
    }
  });
}

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
  // 留空／undefined＝商品共用圖片；有值的話是「規格列當下那個規格的
  // legacy id」（前端規格編輯器用的字串 id，不是 Supabase variant 的
  // uuid——那個 uuid 要等 syncProductVariants 真的寫進去才會有，這裡
  // 存的是存檔當下畫面上那個規格列的身分，兩者用下面的
  // variantLegacyIdToUuid 對照表轉換）。
  variantId?: string;
  variant_id?: string;
};

type BackendVariantInput = {
  id?: string | number;
  sku?: string;
  spec?: string;
  name?: string;
  price?: number;
  costPrice?: number;
  cost_price?: number;
  // 可留空：沒填代表這個規格不顯示特價，跟商品層級原價一樣的語意。
  originalPrice?: number | null;
  original_price?: number | null;
  quantity?: number;
  qty?: number;
  link?: string;
  product_url?: string;
};

// 商品編輯表單重排版後，成本價/定價/原價/庫存都改成規格層級輸入——
// costPrice/listPrice/originalPrice/quantity/quota 這些商品層級欄位這次
// 保留在 payload 型別上（相容沒有送 variants 的舊呼叫端，例如批次新增
// 工具），但只要 variants 有內容，saveBackendProduct 就會改用「依規格
// 算出來的代表值」覆蓋掉這幾個商品層級欄位，不會採信前端這次傳的這些值。
export type BackendProductPayload = {
  id?: string | number;
  name: string;
  description?: string;
  image?: string;
  images?: BackendImageInput[] | string;
  costPrice?: number;
  listPrice?: number;
  originalPrice?: number;
  quantity?: number;
  quota?: number;
  deadline?: string;
  // 預購商品專用：所屬系列（必填，後台表單層級驗證）+ 預計到貨日期。
  // 現貨商品不會送這兩個欄位。
  seriesId?: string;
  estimatedArrivalDate?: string;
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

// 商品存檔部分失敗（例如規格或圖片那一步出錯，但商品基本資料已經寫進去）
// 時丟出這個，訊息會原封不動回給前端 toast；一般未預期的 Supabase 錯誤
// 則不會用這個類別，API route 那邊會改回通用訊息，不洩漏資料庫內部細節。
export class BackendProductSaveError extends Error {}

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason) return String((reason as { message: unknown }).message);
  return String(reason);
}

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

type VariantRowForSupabase = {
  legacy_id: string;
  sku: string;
  spec: string;
  price: number;
  cost_price: number;
  original_price: number | null;
  stock_quantity: number;
  product_url: string;
  status: "active" | "sold_out" | "draft";
  sort_order: number;
};

function getVariantsForSupabase(product: BackendProductPayload, productType: BackendProductType, legacyId: string): VariantRowForSupabase[] {
  const qty = getQuantity(product, productType);
  let raw = Array.isArray(product.variants) ? product.variants : parseJsonArray<BackendVariantInput>(product.variantsJson);
  if (!raw.length) {
    // 沒有送 variants（例如還沒改用新表單的其他呼叫端）才退回舊的「拿商品
    // 層級欄位合成一個預設款規格」邏輯，確保這些呼叫端不用跟著改。
    raw = [{
      id: `${legacyId}-1`,
      spec: "預設款",
      price: Number(product.listPrice || 0),
      costPrice: Number(product.costPrice || 0),
      originalPrice: product.originalPrice,
      quantity: qty,
      link: "",
    }];
  }
  return raw.map((variant, index) => {
    const stockQuantity = Number(variant.quantity ?? variant.qty ?? 0);
    const originalPriceRaw = variant.originalPrice ?? variant.original_price;
    return {
      legacy_id: String(variant.id || `${legacyId}-${index + 1}`),
      sku: String(variant.sku || ""),
      spec: String(variant.spec || variant.name || "預設款").trim() || "預設款",
      price: Number(variant.price ?? product.listPrice ?? 0),
      cost_price: Number(variant.costPrice ?? variant.cost_price ?? 0),
      // 可留空：null／undefined／0 都當作「沒填」，不顯示特價。
      original_price: originalPriceRaw ? Number(originalPriceRaw) : null,
      stock_quantity: stockQuantity,
      product_url: String(variant.link || variant.product_url || ""),
      status: supabaseStatus(product.active, stockQuantity),
      sort_order: index,
    };
  });
}

// 商品層級的 base_price/cost_price/original_price/stock_quantity 這幾個
// 「保留但不再是主要資料」的欄位（見 migration 說明），這次改成依規格
// 算出來的代表值寫入，不要變成完全沒人維護、長期跟真實規格資料脫鉤的
// 廢欄位——萬一還有地方在讀商品層級欄位（目前已知的是結帳 RPC 在完全
// 沒有 variant_id 這個邊界情況下的 fallback），拿到的會是一個合理值。
// 代表規格的挑法跟前台 pickDisplayVariant（src/lib/products.ts）一致：
// 優先選「上架中且有庫存」裡最便宜的，其次「上架中」裡最便宜的，再不然
// 就選全部規格裡最便宜的。
function pickRepresentativeVariant<T extends { price: number; status: string; stock_quantity: number }>(variants: T[]): T {
  const cheapest = (pool: T[]) => pool.reduce((min, variant) => (variant.price < min.price ? variant : min), pool[0]);
  const inStock = variants.filter((variant) => variant.status === "active" && variant.stock_quantity > 0);
  if (inStock.length) return cheapest(inStock);
  const active = variants.filter((variant) => variant.status === "active");
  if (active.length) return cheapest(active);
  return cheapest(variants);
}

function summarizeVariantsForProduct(variants: VariantRowForSupabase[]) {
  const representative = pickRepresentativeVariant(variants);
  const totalQuantity = variants.reduce((sum, variant) => sum + variant.stock_quantity, 0);
  return {
    basePrice: representative.price,
    costPrice: representative.cost_price,
    originalPrice: representative.original_price,
    totalQuantity,
  };
}

function getImagesForSupabase(product: BackendProductPayload) {
  const rawImages = Array.isArray(product.images) ? product.images : parseJsonArray<BackendImageInput>(product.images);
  return rawImages
    .map((image, index) => ({
      publicId: String(image.publicId || image.public_id || ""),
      url: String(image.url || ""),
      isPrimary: image.isPrimary === true || image.is_primary === true,
      sortOrder: Number(image.sortOrder ?? image.sort_order ?? index),
      variantLegacyId: String(image.variantId || image.variant_id || "").trim() || undefined,
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

// 回傳「規格 legacy id → 這次新插入的 Supabase variant uuid」對照表
// 給 syncProductImages 用——product_variants 每次存檔都是整組刪除、
// 重新插入（不是 upsert），uuid 每次都會換新的，圖片的 variant_id
// 外鍵一定要等這批新的規格真的寫進去、拿到新 uuid 之後才能解析，
// 不能跟圖片平行處理。variantRows 由呼叫端先算好傳進來（saveBackendProduct
// 本身也需要同一份資料去算商品層級的代表值），不在這裡重算一次。
async function syncProductVariants(
  supabase: SupabaseServiceClient,
  productId: string,
  variantRows: VariantRowForSupabase[],
): Promise<Map<string, string>> {
  await supabase.from("product_variants").delete().eq("product_id", productId);
  const variants = variantRows.map((variant) => ({ ...variant, product_id: productId }));
  if (!variants.length) return new Map();
  let { data: inserted, error } = await supabase.from("product_variants").insert(variants).select("id,legacy_id");
  if (error && isMissingColumnError(error)) {
    // product_variants.cost_price/original_price 這個欄位的 migration
    // （202610150001）還沒套用到這個環境——退回沒有這兩個欄位的 insert，
    // 不要讓「規格存檔」這個既有功能被這次新增的欄位拖垮。使用者這次填
    // 的成本價/原價會暫時存不進去，規格名稱/價格/庫存照常正常儲存。
    const fallbackVariants = variants.map((variant) => {
      const fallback: Partial<(typeof variants)[number]> = { ...variant };
      delete fallback.cost_price;
      delete fallback.original_price;
      return fallback;
    });
    const retry = await supabase.from("product_variants").insert(fallbackVariants).select("id,legacy_id");
    inserted = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return new Map((inserted || []).map((row) => [String(row.legacy_id), row.id as string]));
}

async function syncProductImages(
  supabase: SupabaseServiceClient,
  productId: string,
  product: BackendProductPayload,
  variantLegacyIdToUuid: Map<string, string>,
) {
  await supabase.from("product_images").delete().eq("product_id", productId);
  const images = getImagesForSupabase(product);
  if (!images.length) return;
  const rows = images.map((image, index) => ({
    product_id: productId,
    public_id: image.publicId,
    secure_url: image.url,
    alt_text: product.name || "",
    sort_order: index,
    is_primary: image.isPrimary === true,
    // 對照表裡找不到（規格已經被刪掉、或這張圖本來就是商品共用圖片）
    // 就存 null，退回「商品共用圖片」，不會讓整筆存檔失敗。
    variant_id: image.variantLegacyId ? variantLegacyIdToUuid.get(image.variantLegacyId) || null : null,
  }));
  const { error } = await supabase.from("product_images").insert(rows);
  if (error && isMissingColumnError(error)) {
    // product_images.variant_id 這個欄位的 migration
    // （202610140001）還沒套用到這個環境——退回沒有 variant_id 的
    // insert，不要讓「圖片存檔」這個既有功能也被這次新增的欄位拖垮。
    const fallbackRows = rows.map((row) => {
      const fallback: Partial<(typeof rows)[number]> = { ...row };
      delete fallback.variant_id;
      return fallback;
    });
    await supabase.from("product_images").insert(fallbackRows);
    return;
  }
  if (error) throw error;
}

export async function saveBackendProduct(
  productType: BackendProductType,
  product: BackendProductPayload,
): Promise<BackendProductSaveResult> {
  if (!product || !product.name) throw new BackendProductSaveError("商品名稱不可為空。");
  // 系列是預購商品的必填欄位——資料庫層級故意沒有 not null constraint
  // （現貨商品不用填），這裡在應用層擋，跟商品名稱的檢查放在一起。
  const seriesId = productType === "preorder" ? String(product.seriesId || "").trim() : "";
  if (productType === "preorder" && !seriesId) throw new BackendProductSaveError("請選擇所屬系列。");

  const legacyId = String(product.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const variantRows = getVariantsForSupabase(product, productType, legacyId);
  if (!variantRows.length) throw new BackendProductSaveError("請至少填寫一個規格。");
  // 成本價/定價/原價/庫存全部改成規格層級輸入，商品層級的這幾個欄位
  // 這次改成依規格算出來的代表值（見 summarizeVariantsForProduct），
  // 不再採信前端這次傳的 product.costPrice/listPrice/originalPrice/
  // quantity/quota——那幾個欄位只在「完全沒送 variants」的舊呼叫端
  // 才會被 getVariantsForSupabase 的 fallback 用到。
  const summary = summarizeVariantsForProduct(variantRows);

  const supabase = createSupabaseServiceClient();
  const productPayload = {
    legacy_id: legacyId,
    product_type: productType,
    name: String(product.name),
    description: product.description || "",
    image_url: product.image || "",
    cost_price: summary.costPrice,
    base_price: summary.basePrice,
    original_price: summary.originalPrice,
    stock_quantity: productType === "stock" ? summary.totalQuantity : 0,
    preorder_quota: productType === "preorder" ? summary.totalQuantity : null,
    deadline: productType === "preorder" && product.deadline ? product.deadline : null,
    series_id: productType === "preorder" ? seriesId : null,
    estimated_arrival_date: productType === "preorder" && product.estimatedArrivalDate ? product.estimatedArrivalDate : null,
    status: supabaseStatus(product.active, summary.totalQuantity),
    source: "backend_admin",
  };

  let { data: rows, error } = await supabase
    .from("products")
    .upsert(productPayload, { onConflict: "legacy_id" })
    .select("id")
    .limit(1);
  if (error && isMissingColumnError(error)) {
    // products.series_id/estimated_arrival_date（202610180001）還沒套用
    // 到這個環境——退回沒有這兩個欄位的 upsert，不要讓「商品存檔」這個
    // 既有功能被這次新增的欄位拖垮。
    const fallbackPayload: Partial<typeof productPayload> = { ...productPayload };
    delete fallbackPayload.series_id;
    delete fallbackPayload.estimated_arrival_date;
    const retry = await supabase.from("products").upsert(fallbackPayload, { onConflict: "legacy_id" }).select("id").limit(1);
    rows = retry.data;
    error = retry.error;
  }
  if (error && isMissingColumnError(error)) {
    // products.original_price 這個欄位的 migration（202610140001）
    // 還沒套用到這個環境——退回沒有這個欄位的 upsert，不要讓「商品
    // 存檔」這個既有功能被這次新增的「原價」欄位拖垮。使用者這次填的
    // 原價會暫時存不進去，但其他欄位照常正常儲存。
    const fallbackPayload: Partial<typeof productPayload> = { ...productPayload };
    delete fallbackPayload.original_price;
    delete fallbackPayload.series_id;
    delete fallbackPayload.estimated_arrival_date;
    const retry = await supabase.from("products").upsert(fallbackPayload, { onConflict: "legacy_id" }).select("id").limit(1);
    rows = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  let savedId = rows?.[0]?.id as string | undefined;
  if (!savedId) {
    const { data: existing } = await supabase.from("products").select("id").eq("legacy_id", legacyId).maybeSingle();
    savedId = existing?.id;
  }
  if (!savedId) throw new Error("Supabase 商品儲存未回傳 id。");

  // 商品基本資料（上面的 upsert）這時已經確定存成功了。分類可以跟規格/
  // 圖片完全平行，彼此不互相依賴；但規格跟圖片不能再平行——圖片的
  // variant_id 外鍵要等規格這次重新插入、拿到新的 uuid 之後才能解析
  // （product_variants 每次存檔都整組砍掉重建，uuid 不是穩定的），所以
  // 圖片一定要排在規格完成之後。用 allSettled 而不是 all：其中一邊失敗
  // 時另一邊該做的還是要做完，然後把「哪一邊失敗」講清楚丟回去，不要
  // 整個吞掉或讓使用者以為全部都存成功了。
  const tagIds = Array.isArray(product.tagIds) ? product.tagIds : parseJsonArray<string | number>(product.tagIds);
  const [categoriesOutcome, variantsAndImagesOutcome] = await Promise.allSettled([
    syncProductCategories(supabase, savedId, tagIds),
    (async () => {
      const variantLegacyIdToUuid = await syncProductVariants(supabase, savedId, variantRows);
      await syncProductImages(supabase, savedId, product, variantLegacyIdToUuid);
    })(),
  ]);

  const failures: string[] = [];
  if (categoriesOutcome.status === "rejected") failures.push(`IP／商品類別：${describeError(categoriesOutcome.reason)}`);
  if (variantsAndImagesOutcome.status === "rejected") failures.push(`規格或圖片：${describeError(variantsAndImagesOutcome.reason)}`);
  if (failures.length) {
    throw new BackendProductSaveError(`商品基本資料已儲存，但${failures.join("；")}儲存失敗，請重新整理後確認並再試一次。`);
  }

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

// 以下是列表讀取（上一輪商品存檔/刪除遷移時刻意沒做，後台列表當時還是
// 靠 Apps Script 的 doGet()/readData() 供應）。欄位對應原樣比照
// lily-backend-Code.gs 的 readSupabaseProducts()/applyProductImages()/
// normalizeProductImages() 搬過來，確保回傳形狀跟後台前端
// applyBackendData() 原本預期的 stockProducts/preorderProducts 元素
// 完全一致，前端不用跟著大改。

type RawImageRow = { url?: string; publicId?: string; isPrimary?: boolean; sortOrder?: number; variantId?: string };
export type BackendProductImage = { url: string; publicId: string; isPrimary: boolean; sortOrder: number; variantId?: string };

// 比照 .gs 的 normalizeProductImageUrl：只接受完整 http(s) 網址，或是
// 本地 /images/xxx.ext 這種舊的相對路徑慣例，其餘一律視為無效回傳空字串。
function normalizeProductImageUrl(image: string | undefined | null): string {
  const raw = String(image || "").trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) return "";
  const clean = raw.replace(/[?#].*$/, "").replace(/\\/g, "/");
  const relative = clean.replace(/^\/?images\//i, "").replace(/^\/+/, "");
  if (!relative || relative.split("/").includes("..")) return "";
  if (!/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(relative)) return "";
  return "/images/" + relative;
}

function normalizeProductImageEntry(entry: RawImageRow, index: number): BackendProductImage | null {
  const url = normalizeProductImageUrl(entry.url);
  if (!url) return null;
  const sortOrder = entry.sortOrder !== undefined ? entry.sortOrder : index;
  return { url, publicId: String(entry.publicId || ""), isPrimary: entry.isPrimary === true, sortOrder: Number(sortOrder), variantId: entry.variantId || undefined };
}

// 比照 .gs 的 normalizePrimaryProductImages：重新決定唯一一張 isPrimary
// （沒有任何一張被標記時退回第一張），並把 sortOrder 重新編號成 0,1,2...
function normalizePrimaryProductImages(images: (BackendProductImage | null)[]): BackendProductImage[] {
  const normalized = images.filter((image): image is BackendProductImage => !!image);
  if (!normalized.length) return [];
  let primaryIndex = normalized.findIndex((image) => image.isPrimary);
  if (primaryIndex < 0) primaryIndex = 0;
  return normalized.map((image, index) => ({ ...image, isPrimary: index === primaryIndex, sortOrder: index }));
}

// 比照 .gs 的 applyProductImages：用重新正規化過的 images[] 回推
// product.image（取 primary 那張，沒有就取第一張），確保 image_url 欄位
// 跟實際的 primary 圖片標記不會兜不起來。
function applyProductImages(imageUrl: string, rawImages: RawImageRow[]): { image: string; images: BackendProductImage[] } {
  const images = normalizePrimaryProductImages(
    rawImages.map((entry, index) => normalizeProductImageEntry(entry, index)).sort((a, b) => Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0)),
  );
  const fallback = normalizeProductImageEntry({ url: imageUrl }, images.length);
  const merged = fallback && !images.some((image) => image.url === fallback.url) ? normalizePrimaryProductImages([...images, fallback]) : images;
  const primary = merged.find((image) => image.isPrimary) || merged[0];
  return { image: primary?.url || "", images: merged };
}

export type BackendProductListItem = {
  id: string;
  name: string;
  costPrice: number;
  listPrice: number;
  originalPrice?: number;
  quantity?: number;
  quota?: number;
  deadline: string;
  seriesId?: string;
  estimatedArrivalDate?: string;
  tagIds: string[];
  description: string;
  image: string;
  images: BackendProductImage[];
  active: boolean;
  variantsJson: string;
  variants: { id: string; spec: string; price: number; costPrice: number; originalPrice?: number; quantity: number; link: string }[];
  createdAt: string;
  updatedAt: string;
};

type RawProductRow = {
  id: string;
  legacy_id: string | null;
  name: string | null;
  description: string | null;
  image_url: string | null;
  cost_price: number | null;
  base_price: number | null;
  original_price: number | null;
  stock_quantity: number | null;
  preorder_quota: number | null;
  deadline: string | null;
  series_id?: string | null;
  estimated_arrival_date?: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  product_variants: { id: string; legacy_id: string | null; spec: string | null; price: number | null; cost_price?: number | null; original_price?: number | null; stock_quantity: number | null; product_url: string | null }[] | null;
  product_images: { id: string; public_id: string | null; secure_url: string | null; sort_order: number | null; is_primary: boolean | null; variant_id: string | null }[] | null;
  product_categories: { categories: { id: string; legacy_id: string | null } | null }[] | null;
};

function mapProductRow(row: RawProductRow, productType: BackendProductType): BackendProductListItem {
  const variants = (row.product_variants || []).map((variant) => ({
    id: String(variant.legacy_id || variant.id),
    spec: variant.spec || "預設款",
    price: Number(variant.price || 0),
    costPrice: Number(variant.cost_price || 0),
    originalPrice: variant.original_price != null ? Number(variant.original_price) : undefined,
    quantity: Number(variant.stock_quantity || 0),
    link: variant.product_url || "",
  }));
  const tagIds = (row.product_categories || [])
    .map((link) => link.categories)
    .filter((category): category is NonNullable<typeof category> => !!category)
    .map((category) => String(category.legacy_id || category.id));
  const quantity = productType === "stock" ? Number(row.stock_quantity || 0) : Number(row.preorder_quota || 0);
  // 圖片的 variant_id 存的是 Supabase variant uuid，但後台畫面上規格是
  // 用 legacy_id 辨識的（上面 variants 的 id 就是 legacy_id || uuid）——
  // 這裡建一個 uuid → legacy_id 的對照表，把圖片的 variant_id 轉回
  // 畫面看得懂的那個 id，前端規格下拉選單才能正確預選。
  const variantUuidToLegacyId = new Map(
    (row.product_variants || []).map((variant) => [variant.id, String(variant.legacy_id || variant.id)]),
  );
  const rawImages = (row.product_images || []).map((image) => ({
    url: image.secure_url || "",
    publicId: image.public_id || "",
    isPrimary: image.is_primary === true,
    sortOrder: image.sort_order ?? undefined,
    variantId: image.variant_id ? variantUuidToLegacyId.get(image.variant_id) : undefined,
  }));
  const { image, images } = applyProductImages(row.image_url || "", rawImages);
  return {
    id: String(row.legacy_id || row.id),
    name: row.name || "",
    costPrice: Number(row.cost_price || 0),
    listPrice: Number(row.base_price || 0),
    originalPrice: row.original_price != null ? Number(row.original_price) : undefined,
    ...(productType === "stock" ? { quantity } : { quota: quantity }),
    deadline: row.deadline || "",
    seriesId: row.series_id || undefined,
    estimatedArrivalDate: row.estimated_arrival_date || undefined,
    tagIds,
    description: row.description || "",
    image,
    images,
    active: row.status === "active",
    variantsJson: JSON.stringify(variants),
    variants,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

// 三層 select，從新到舊依序嘗試。欄位不存在在兩種操作下 Supabase 回傳的
// 錯誤碼不一樣：SELECT 查詢是原始 Postgres 的 42703（undefined_column）；
// INSERT/UPSERT 則是 PostgREST 自己在送進資料庫前，對照它快取的 schema
// 比對到的 PGRST204（"Could not find the '<column>' column ... in the
// schema cache"）——這裡兩種都要認得，只認 42703 會漏接寫入時的這個情況。
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

// products.series_id/estimated_arrival_date（202610180001）是這輪才加的
// 新欄位，所以排在最外層一層——比上面所有舊欄位都更可能在某個環境還沒
// 套用 migration，拿不到就退回下一層（沒有這兩個欄位，但其他都在）。
const PRODUCT_LIST_SELECT_WITH_SERIES = [
  "id",
  "legacy_id",
  "name",
  "description",
  "image_url",
  "cost_price",
  "base_price",
  "original_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "series_id",
  "estimated_arrival_date",
  "status",
  "created_at",
  "updated_at",
  "product_variants(id,legacy_id,spec,price,cost_price,original_price,stock_quantity,product_url)",
  "product_images(id,public_id,secure_url,sort_order,is_primary,variant_id)",
  "product_categories(categories(id,legacy_id))",
].join(",");

const PRODUCT_LIST_SELECT_WITH_VARIANT_COST_AND_ORIGINAL = [
  "id",
  "legacy_id",
  "name",
  "description",
  "image_url",
  "cost_price",
  "base_price",
  "original_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  "product_variants(id,legacy_id,spec,price,cost_price,original_price,stock_quantity,product_url)",
  "product_images(id,public_id,secure_url,sort_order,is_primary,variant_id)",
  "product_categories(categories(id,legacy_id))",
].join(",");

// product_variants.cost_price/original_price 是這輪才加的新欄位
// （202610150001 這份 migration）還沒套用到環境時退回這一層——跟上面
// 差在規格的 cost_price/original_price 拿不到，其他（包含上一輪加的
// products.original_price／product_images.variant_id）都還在。
const PRODUCT_LIST_SELECT_WITHOUT_VARIANT_COST_AND_ORIGINAL = [
  "id",
  "legacy_id",
  "name",
  "description",
  "image_url",
  "cost_price",
  "base_price",
  "original_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  "product_variants(id,legacy_id,spec,price,stock_quantity,product_url)",
  "product_images(id,public_id,secure_url,sort_order,is_primary,variant_id)",
  "product_categories(categories(id,legacy_id))",
].join(",");

// 比上面兩層更舊：連上一輪加的 products.original_price／
// product_images.variant_id 都還沒套用。確保「商品列表讀取」這個很早
// 之前就在正常運作的既有功能，不會被任何一輪新增的欄位拖垮，只是新
// 欄位暫時拿不到。
const PRODUCT_LIST_SELECT_LEGACY = [
  "id",
  "legacy_id",
  "name",
  "description",
  "image_url",
  "cost_price",
  "base_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  "product_variants(id,legacy_id,spec,price,stock_quantity,product_url)",
  "product_images(id,public_id,secure_url,sort_order,is_primary)",
  "product_categories(categories(id,legacy_id))",
].join(",");

export async function listBackendProducts(productType: BackendProductType): Promise<BackendProductListItem[]> {
  const supabase = createSupabaseServiceClient();

  for (const select of [
    PRODUCT_LIST_SELECT_WITH_SERIES,
    PRODUCT_LIST_SELECT_WITH_VARIANT_COST_AND_ORIGINAL,
    PRODUCT_LIST_SELECT_WITHOUT_VARIANT_COST_AND_ORIGINAL,
    PRODUCT_LIST_SELECT_LEGACY,
  ]) {
    const { data, error } = await supabase
      .from("products")
      .select(select)
      .eq("product_type", productType)
      .order("created_at", { ascending: false })
      .returns<RawProductRow[]>();
    if (!error) return (data || []).map((row) => mapProductRow(row, productType));
    if (!isMissingColumnError(error)) throw error;
  }

  return [];
}

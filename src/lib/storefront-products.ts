import { categories as fallbackCategories, pickDisplayVariant, products as fallbackProducts, Product, ProductTag, ProductVariant } from "@/lib/products";

type SupabaseProductRow = {
  id: string;
  legacy_id: string | null;
  product_type: "stock" | "preorder";
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number | null;
  original_price: number | null;
  stock_quantity: number | null;
  preorder_quota: number | null;
  deadline: string | null;
  status: "active" | "sold_out" | "draft";
  created_at: string;
  updated_at: string;
  product_images?: Array<{
    secure_url: string;
    sort_order: number | null;
    is_primary: boolean | null;
  }> | null;
  product_categories?: Array<{
    categories?: {
      name?: string | null;
      id?: string | null;
      legacy_id?: string | null;
      type?: "ip" | "category" | null;
      enabled?: boolean | null;
      sort_order?: number | null;
      color?: string | null;
    } | null;
  }> | null;
  product_variants?: Array<{
    id: string;
    legacy_id?: string | null;
    spec?: string | null;
    price?: number | null;
    original_price?: number | null;
    stock_quantity?: number | null;
    product_url?: string | null;
    status?: "active" | "sold_out" | "draft" | null;
    sort_order?: number | null;
  }> | null;
};

function supabaseHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!process.env.SUPABASE_URL?.trim() || !key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function supabaseFetch<T>(path: string): Promise<T | null> {
  const headers = supabaseHeaders();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!headers || !baseUrl) return null;

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    console.warn(`Supabase storefront products fetch failed (${response.status})`);
    return null;
  }

  return (await response.json()) as T;
}

function categoryFromRow(row: SupabaseProductRow) {
  const linkedCategory = row.product_categories
    ?.map((link) => link.categories)
    .find((category) => category?.type !== "ip" && category?.name)?.name;

  if (linkedCategory) return linkedCategory;
  return row.product_type === "preorder" ? "預購商品" : "現貨商品";
}

function tagsFromRow(row: SupabaseProductRow): ProductTag[] {
  return (row.product_categories || [])
    .map((link, index): ProductTag | null => {
      const category = link.categories;
      if (!category?.name) return null;
      const type = category.type === "ip" ? "ip" : "category";
      return {
        id: String(category.legacy_id || category.id || category.name),
        name: category.name,
        type,
        enabled: category.enabled !== false,
        sortOrder: Number(category.sort_order ?? index),
        color: category.color || undefined,
      };
    })
    .filter((tag): tag is ProductTag => Boolean(tag))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// 商品卡片（列表頁）的圖片滑動不需要分辨哪張圖屬於哪個規格——商品
// 共用圖片跟各規格專屬圖片在卡片上就是同一組圖池，一視同仁，只有
// 詳情頁（src/lib/product-detail.ts）才需要 variant_id 去判斷規格
// 專屬圖片要不要自動切換。
function imagesFromRow(row: SupabaseProductRow): string[] {
  const rows = (row.product_images || []).filter((image) => image.secure_url);
  if (!rows.length) return row.image_url ? [row.image_url] : [];
  return rows
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((image) => image.secure_url);
}

function variantsFromRow(row: SupabaseProductRow): ProductVariant[] {
  const normalizeStatus = (status: "active" | "sold_out" | "draft" | null | undefined): ProductVariant["status"] => (
    status === "sold_out" || status === "draft" ? status : "active"
  );
  return (row.product_variants || [])
    .filter((variant) => variant.spec)
    .map((variant, index) => ({
      id: variant.id,
      legacyId: variant.legacy_id || undefined,
      spec: variant.spec || "",
      price: variant.price,
      originalPrice: variant.original_price,
      stockQuantity: variant.stock_quantity,
      productUrl: variant.product_url || undefined,
      status: normalizeStatus(variant.status),
      sortOrder: Number(variant.sort_order ?? index),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function mapStorefrontProduct(row: SupabaseProductRow): Product {
  const isPreorder = row.product_type === "preorder";
  const status = row.status === "sold_out"
    ? "sold_out"
    : row.status === "draft"
      ? "hidden"
      : isPreorder
        ? "preorder"
        : "in_stock";
  const tags = tagsFromRow(row);
  const variants = variantsFromRow(row);
  // 多規格商品的卡片價格要看「現在」的規格資料算出來的代表價，不是存檔當下
  // 寫進 products.base_price 的舊快照——規格庫存會被結帳直接扣減，不會
  // 連帶更新 products 表，用即時的 variants 現算才不會顯示過期的價格/庫存
  // 狀態。沒有任何規格（理論上不會發生，保留當防呆）才退回商品層級欄位。
  const displayVariant = pickDisplayVariant(variants);
  const price = displayVariant ? Number(displayVariant.price ?? 0) : Number(row.base_price || 0);
  const originalPrice = displayVariant
    ? (displayVariant.originalPrice != null ? Number(displayVariant.originalPrice) : undefined)
    : (row.original_price != null ? Number(row.original_price) : undefined);

  return {
    id: row.legacy_id || row.id,
    name_zh: row.name,
    sku: row.legacy_id || row.id,
    price,
    original_price: originalPrice,
    status,
    productType: row.product_type,
    category: tags.find((tag) => tag.type === "category")?.name || categoryFromRow(row),
    brand: tags.find((tag) => tag.type === "ip")?.name,
    tags,
    stock_quantity: isPreorder ? row.preorder_quota : row.stock_quantity,
    images: imagesFromRow(row),
    description: row.description || "",
    source: "Pinkkkuin",
    preorder_note: isPreorder && row.deadline ? `預購截止：${row.deadline}` : undefined,
    variants,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PRODUCT_CATEGORIES_SELECT = "product_categories(categories(id,legacy_id,name,type,enabled,sort_order,color))";

// 三層 select，從新到舊依序嘗試：新欄位的 migration 還沒套用到環境時，
// 整包查詢會直接失敗（Postgres 42703），退到少一點新欄位的版本重試，確保
// 「商品列表讀得到」這個既有功能不會被這輪、或上一輪新增的欄位拖垮——
// 只有真的用到的新欄位才會暫時拿不到，不是整個列表讀取失敗。
const SELECT_WITH_VARIANT_ORIGINAL_PRICE = [
  "id",
  "legacy_id",
  "product_type",
  "name",
  "description",
  "image_url",
  "base_price",
  "original_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  PRODUCT_CATEGORIES_SELECT,
  "product_variants(id,legacy_id,spec,price,original_price,stock_quantity,product_url,status,sort_order)",
  "product_images(secure_url,sort_order,is_primary)",
].join(",");
const SELECT_WITHOUT_VARIANT_ORIGINAL_PRICE = [
  "id",
  "legacy_id",
  "product_type",
  "name",
  "description",
  "image_url",
  "base_price",
  "original_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  PRODUCT_CATEGORIES_SELECT,
  "product_variants(id,legacy_id,spec,price,stock_quantity,product_url,status,sort_order)",
  "product_images(secure_url,sort_order,is_primary)",
].join(",");
const LEGACY_SELECT = [
  "id",
  "legacy_id",
  "product_type",
  "name",
  "description",
  "image_url",
  "base_price",
  "stock_quantity",
  "preorder_quota",
  "deadline",
  "status",
  "created_at",
  "updated_at",
  "product_categories(categories(id,legacy_id,name,color))",
].join(",");

export async function getStorefrontProducts() {
  let rows: SupabaseProductRow[] | null = null;
  for (const select of [SELECT_WITH_VARIANT_ORIGINAL_PRICE, SELECT_WITHOUT_VARIANT_ORIGINAL_PRICE, LEGACY_SELECT]) {
    rows = await supabaseFetch<SupabaseProductRow[]>(
      `products?select=${encodeURIComponent(select)}&status=in.(active,sold_out)&order=created_at.desc`,
    );
    if (rows) break;
  }

  if (!rows) return fallbackProducts;
  return rows.map(mapStorefrontProduct).filter((product) => product.status !== "hidden");
}

export async function getStorefrontCategories() {
  const products = await getStorefrontProducts();
  const names = products.map((product) => product.category).filter(Boolean);
  return Array.from(new Set([...names, ...fallbackCategories]));
}

export async function getFeaturedStorefrontProducts(limit = 6) {
  const products = await getStorefrontProducts();
  return products.slice(0, limit);
}

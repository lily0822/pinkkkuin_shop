import { getProductById, pickDisplayVariant, Product, ProductVariant } from "@/lib/products";
import { getStorefrontProducts } from "@/lib/storefront-products";

export type ProductGalleryImage = {
  url: string;
  publicId?: string;
  sortOrder: number;
  isPrimary: boolean;
  altText?: string;
  // 留空＝商品共用圖片，隨時可以手動瀏覽；有值＝只屬於該規格，選到
  // 那個規格時才會被 ProductGallery 自動切過去顯示。
  variantId?: string;
};

type SupabaseVariantRow = {
  id: string;
  legacy_id: string | null;
  spec: string | null;
  price: number | null;
  original_price?: number | null;
  stock_quantity: number | null;
  product_url: string | null;
  status: "active" | "sold_out" | "draft" | null;
  sort_order: number | null;
};

type SupabaseProductRow = {
  id: string;
  legacy_id: string | null;
  product_type: "stock" | "preorder";
  name: string;
  description: string | null;
  image_url: string | null;
  cost_price: number | null;
  base_price: number | null;
  original_price: number | null;
  stock_quantity: number | null;
  preorder_quota: number | null;
  deadline: string | null;
  status: "active" | "sold_out" | "draft";
  created_at: string;
  updated_at: string;
  product_variants?: SupabaseVariantRow[] | null;
};

type SupabaseImageRow = {
  public_id: string | null;
  secure_url: string;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
  variant_id: string | null;
};

export type ProductDetailData = {
  product: Product;
  galleryImages: ProductGalleryImage[];
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
    console.warn(`Supabase product detail fetch failed (${response.status})`);
    return null;
  }

  return (await response.json()) as T;
}

function staticGalleryImages(product: Product): ProductGalleryImage[] {
  return product.images
    .filter(Boolean)
    .map((url, index) => ({
      url,
      sortOrder: index,
      isPrimary: index === 0,
      altText: product.name_zh,
    }));
}

function normalizeGalleryImages(productName: string, imageUrl: string | null, rows: SupabaseImageRow[] = []): ProductGalleryImage[] {
  const gallery = rows
    .filter((row) => row.secure_url)
    .map((row, index) => ({
      url: row.secure_url,
      publicId: row.public_id || undefined,
      sortOrder: Number(row.sort_order ?? index),
      isPrimary: row.is_primary === true,
      altText: row.alt_text || productName,
      variantId: row.variant_id || undefined,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (gallery.length) {
    const primaryIndex = gallery.findIndex((image) => image.isPrimary);
    if (primaryIndex < 0) {
      gallery[0].isPrimary = true;
    } else {
      gallery.forEach((image, index) => {
        image.isPrimary = index === primaryIndex;
      });
    }
    return gallery.map((image, index) => ({ ...image, sortOrder: index }));
  }

  if (!imageUrl) return [];
  return [
    {
      url: imageUrl,
      sortOrder: 0,
      isPrimary: true,
      altText: productName,
    },
  ];
}

// 規格專屬圖片：直接從已經抓好的 galleryImages 裡找這個規格的圖（這份
// 資料本來就有 variantId，不用再另外查一次 product_images），標記
// isPrimary 的優先、否則 sortOrder 最小的那張。沒有專屬圖片就是
// undefined，不 fallback 成商品主圖。
function variantImageFromGallery(galleryImages: ProductGalleryImage[], variantId: string): string | undefined {
  const matches = galleryImages.filter((image) => image.variantId === variantId);
  if (!matches.length) return undefined;
  return matches.find((image) => image.isPrimary)?.url || matches[0].url;
}

function normalizeVariants(rows: SupabaseVariantRow[] = [], galleryImages: ProductGalleryImage[] = []): ProductVariant[] {
  const normalizeStatus = (status: SupabaseVariantRow["status"]): ProductVariant["status"] => (
    status === "sold_out" || status === "draft" ? status : "active"
  );
  return rows
    .filter((row) => row.spec)
    .map((row, index) => ({
      id: row.id,
      legacyId: row.legacy_id || undefined,
      spec: row.spec || "",
      price: row.price,
      originalPrice: row.original_price,
      stockQuantity: row.stock_quantity,
      productUrl: row.product_url || undefined,
      imageUrl: variantImageFromGallery(galleryImages, row.id),
      status: normalizeStatus(row.status),
      sortOrder: Number(row.sort_order ?? index),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function mapSupabaseProduct(row: SupabaseProductRow, galleryImages: ProductGalleryImage[], variants: ProductVariant[]): Product {
  const isPreorder = row.product_type === "preorder";
  const status = row.status === "sold_out"
    ? "sold_out"
    : row.status === "draft"
      ? "hidden"
      : isPreorder
        ? "preorder"
        : "in_stock";

  // 跟 storefront-products.ts 的 mapStorefrontProduct 同一個理由：詳情頁
  // 標題旁邊還沒選規格時顯示的那個價格，要用即時的 variants 現算，不要用
  // 存檔當下寫進 products.base_price 的舊快照（規格庫存/價格之後都可能
  // 單獨變動，不會連帶更新 products 表）。
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
    category: isPreorder ? "預購商品" : "現貨商品",
    stock_quantity: isPreorder ? row.preorder_quota : row.stock_quantity,
    images: galleryImages.map((image) => image.url),
    description: row.description || "",
    source: "Pinkkkuin",
    preorder_note: isPreorder && row.deadline ? `預購截止：${row.deadline}` : undefined,
    variants,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isUuid(value: string) {
  // 原本缺一個 dash（第四段跟第五段黏成 1+12=13 字元），任何真實 UUID
  // 都比對不過——這支函式判斷結果會讓 getSupabaseProductById() 對沒有
  // legacy_id 的商品整個跳過 id=eq.<uuid> 查詢、只查 legacy_id（查不到
  // 會回 null），商品詳情頁會變成找不到商品。跟會員訂單明細同一個根因
  // 的另一個真實受影響處，一起修正。
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// 三層 select，從新到舊：新欄位的 migration 還沒套用到環境時，整包查詢
// 會直接失敗（Postgres 42703），退到少一點新欄位的版本重試，確保「商品
// 詳情頁讀得到商品」這個既有功能不會被這輪、或上一輪新增的欄位拖垮。
const PRODUCT_DETAIL_SELECT_WITH_VARIANT_ORIGINAL_PRICE =
  "id,legacy_id,product_type,name,description,image_url,cost_price,base_price,original_price,stock_quantity,preorder_quota,deadline,status,created_at,updated_at,product_variants(id,legacy_id,spec,price,original_price,stock_quantity,product_url,status,sort_order)";
const PRODUCT_DETAIL_SELECT_WITHOUT_VARIANT_ORIGINAL_PRICE =
  "id,legacy_id,product_type,name,description,image_url,cost_price,base_price,original_price,stock_quantity,preorder_quota,deadline,status,created_at,updated_at,product_variants(id,legacy_id,spec,price,stock_quantity,product_url,status,sort_order)";
const PRODUCT_DETAIL_SELECT_LEGACY =
  "id,legacy_id,product_type,name,description,image_url,cost_price,base_price,stock_quantity,preorder_quota,deadline,status,created_at,updated_at,product_variants(id,legacy_id,spec,price,stock_quantity,product_url,status,sort_order)";

async function getSupabaseProductById(id: string) {
  for (const select of [
    PRODUCT_DETAIL_SELECT_WITH_VARIANT_ORIGINAL_PRICE,
    PRODUCT_DETAIL_SELECT_WITHOUT_VARIANT_ORIGINAL_PRICE,
    PRODUCT_DETAIL_SELECT_LEGACY,
  ]) {
    // supabaseFetch 回 null 代表這個 select 本身查詢失敗（例如新欄位還
    // 沒套用 migration），要換下一層再試；回一個陣列（即使是空陣列）
    // 代表這層 select 本身是有效的，只是真的查不到這個商品，不需要再
    // 用少欄位的版本重試一次。
    let queryFailed = false;

    if (isUuid(id)) {
      const byId = await supabaseFetch<SupabaseProductRow[]>(
        `products?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`,
      );
      if (byId === null) queryFailed = true;
      else if (byId[0]) return byId[0];
    }

    const byLegacyId = await supabaseFetch<SupabaseProductRow[]>(
      `products?select=${encodeURIComponent(select)}&legacy_id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    if (byLegacyId === null) queryFailed = true;
    else if (byLegacyId[0]) return byLegacyId[0];

    if (!queryFailed) return null;
  }

  return null;
}

export async function getProductDetailById(id: string): Promise<ProductDetailData | null> {
  const staticProduct = getProductById(id);
  const supabaseProduct = await getSupabaseProductById(id);

  if (supabaseProduct) {
    let imageRows = await supabaseFetch<SupabaseImageRow[]>(
      `product_images?select=public_id,secure_url,alt_text,sort_order,is_primary,variant_id&product_id=eq.${encodeURIComponent(supabaseProduct.id)}&order=sort_order.asc`,
    );
    if (imageRows === null) {
      // product_images.variant_id 這個欄位的 migration（202610140001）還沒
      // 套用時上面的查詢會直接失敗——退回沒有 variant_id 的版本重試，不要
      // 讓「商品圖片讀取」整個失敗，退化成完全沒有圖片。
      const fallbackRows = await supabaseFetch<Array<Omit<SupabaseImageRow, "variant_id">>>(
        `product_images?select=public_id,secure_url,alt_text,sort_order,is_primary&product_id=eq.${encodeURIComponent(supabaseProduct.id)}&order=sort_order.asc`,
      );
      imageRows = fallbackRows ? fallbackRows.map((row) => ({ ...row, variant_id: null })) : null;
    }
    let galleryImages = normalizeGalleryImages(supabaseProduct.name, supabaseProduct.image_url, imageRows || []);
    if (!galleryImages.length && staticProduct) {
      galleryImages = staticGalleryImages(staticProduct);
    }
    if (!galleryImages.length && staticProduct?.images.length) {
      galleryImages = staticGalleryImages(staticProduct);
    }
    if (!galleryImages.length && staticProduct) {
      return {
        product: staticProduct,
        galleryImages: staticGalleryImages(staticProduct),
      };
    }
    const variants = normalizeVariants(supabaseProduct.product_variants || [], galleryImages);
    const product = mapSupabaseProduct(supabaseProduct, galleryImages, variants);
    return {
      product,
      galleryImages,
    };
  }

  const fallbackProduct = staticProduct || (await getStorefrontProducts()).find((product) => product.id === id);
  if (!fallbackProduct) return null;
  const galleryImages = staticGalleryImages(fallbackProduct);
  return {
    product: fallbackProduct,
    galleryImages,
  };
}

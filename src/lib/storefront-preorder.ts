import "server-only";

// /category/preorder 系列管理改版專用的資料讀取——跟 storefront-
// products.ts 共用同一套「raw REST + service role key + 欄位 42703 時
// 退一層」慣例，但這次回傳的形狀完全是給新版預購頁面用的，不是共用的
// Product 型別（那個型別沒有 seriesId/estimatedArrivalDate/deadline
// 這些這次才需要的欄位，硬塞進去只會讓其他現有頁面也要處理一堆它們
// 不需要的欄位）。

export type PreorderIp = {
  name: string;
  sortOrder: number;
};

export type PreorderSeries = {
  id: string;
  name: string;
  coverImageUrl: string;
  sortOrder: number;
  // IP 標籤改掛在系列身上（series_categories 關聯表），不是從底下商品
  // 的標籤反查——一個系列可以直接被標成多個 IP，跟商品本身有沒有填
  // IP 標籤無關（預購商品編輯表單這輪也已經拿掉 IP 選擇欄位）。
  ipNames: string[];
  // 系列的倒數徽章取底下商品裡「最早」的截止時間（最急迫的那個），
  // 不是最晚——越早要結單的系列越該被優先注意到。
  deadline: string | null;
};

export type PreorderProduct = {
  // 給前台連結用（/products/{id}，legacy_id 或 uuid 都接受，跟全站其他
  // 商品卡連結慣例一致）。
  id: string;
  // 真正的 Supabase uuid，「加入預購清單」API 需要真的 uuid，不能是
  // legacy_id——這裡分開存，不是每個呼叫端都要自己重新解析一次。
  supabaseId: string;
  name: string;
  image: string;
  priceMin: number;
  priceMax: number;
  deadline: string | null;
  estimatedArrivalDate: string | null;
  seriesId: string | null;
  createdAt: string;
  // 多規格商品這一輪的「加入」按鈕行為跟既有 ProductCard 一致：導去
  // 商品詳情頁選規格，不在卡片上做規格選擇 UI（範例頁面也沒有）。
  hasMultipleVariants: boolean;
  // 單規格（或沒有規格資料）時，加入清單要帶的 variant uuid；
  // 多規格時是 null（由詳情頁決定選哪個規格）。
  singleVariantId: string | null;
};

type SupabaseProductRow = {
  id: string;
  legacy_id: string | null;
  name: string;
  image_url: string | null;
  deadline: string | null;
  estimated_arrival_date?: string | null;
  series_id?: string | null;
  created_at: string;
  product_images?: Array<{ secure_url: string; sort_order: number | null; is_primary: boolean | null }> | null;
  product_variants?: Array<{
    id: string;
    price: number | null;
    stock_quantity: number | null;
    status: "active" | "sold_out" | "draft" | null;
  }> | null;
};

type SupabaseSeriesRow = {
  id: string;
  name: string | null;
  cover_image_url: string | null;
  sort_order: number | null;
};

type SupabaseSeriesCategoryRow = {
  series_id: string;
  categories?: { name?: string | null; type?: string | null; enabled?: boolean | null } | null;
};

function supabaseHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!process.env.SUPABASE_URL?.trim() || !key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function supabaseFetch<T>(path: string): Promise<T | null> {
  const headers = supabaseHeaders();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!headers || !baseUrl) return null;

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { headers, cache: "no-store" });
  if (!response.ok) {
    console.warn(`Supabase preorder catalog fetch failed (${response.status})`);
    return null;
  }
  return (await response.json()) as T;
}

const PRODUCT_SELECT_WITH_SERIES = [
  "id",
  "legacy_id",
  "name",
  "image_url",
  "deadline",
  "estimated_arrival_date",
  "series_id",
  "created_at",
  "product_images(secure_url,sort_order,is_primary)",
  "product_variants(id,price,stock_quantity,status)",
].join(",");

// products.series_id/estimated_arrival_date（202610180001）還沒套用到
// 這個環境時退回這一層——沒有這兩個欄位，其他照常。
const PRODUCT_SELECT_LEGACY = [
  "id",
  "legacy_id",
  "name",
  "image_url",
  "deadline",
  "created_at",
  "product_images(secure_url,sort_order,is_primary)",
  "product_variants(id,price,stock_quantity,status)",
].join(",");

function imageFromRow(row: SupabaseProductRow): string {
  const rows = (row.product_images || []).filter((image) => image.secure_url);
  if (!rows.length) return row.image_url || "";
  const sorted = rows.slice().sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  return sorted.find((image) => image.is_primary)?.secure_url || sorted[0].secure_url;
}

function priceRangeFromRow(row: SupabaseProductRow): { min: number; max: number } {
  const prices = (row.product_variants || [])
    .filter((variant) => variant.status !== "draft")
    .map((variant) => Number(variant.price ?? 0))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return { min: 0, max: 0 };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// 加入清單用的規格：單規格（或沒有規格資料）直接挑那一個；多規格一律
// 回傳 null，交給商品詳情頁處理——跟 pickDisplayVariant 的「現在有庫存
// 的最便宜那個」邏輯不是同一回事，這裡只在乎「唯一的那一個是誰」。
function singleVariantIdFromRow(row: SupabaseProductRow): { hasMultiple: boolean; singleId: string | null } {
  const variants = (row.product_variants || []).filter((variant) => variant.status !== "draft");
  if (variants.length !== 1) return { hasMultiple: variants.length > 1, singleId: null };
  return { hasMultiple: false, singleId: variants[0].id };
}

function mapProductRow(row: SupabaseProductRow): PreorderProduct {
  const { min, max } = priceRangeFromRow(row);
  const { hasMultiple, singleId } = singleVariantIdFromRow(row);
  return {
    id: row.legacy_id || row.id,
    supabaseId: row.id,
    name: row.name,
    image: imageFromRow(row),
    priceMin: min,
    priceMax: max,
    deadline: row.deadline || null,
    estimatedArrivalDate: row.estimated_arrival_date || null,
    seriesId: row.series_id || null,
    createdAt: row.created_at,
    hasMultipleVariants: hasMultiple,
    singleVariantId: singleId,
  };
}

async function fetchPreorderProductRows(): Promise<SupabaseProductRow[]> {
  for (const select of [PRODUCT_SELECT_WITH_SERIES, PRODUCT_SELECT_LEGACY]) {
    const rows = await supabaseFetch<SupabaseProductRow[]>(
      `products?select=${encodeURIComponent(select)}&product_type=eq.preorder&status=eq.active&order=created_at.desc`,
    );
    if (rows) return rows;
  }
  return [];
}

async function fetchSeriesRows(): Promise<SupabaseSeriesRow[]> {
  const rows = await supabaseFetch<SupabaseSeriesRow[]>(
    "product_series?select=id,name,cover_image_url,sort_order&order=sort_order.asc,name.asc",
  );
  return rows || [];
}

// series_categories（202610190001）還沒套用到這個環境時 supabaseFetch
// 會因為 404 回傳 null——退回空陣列，系列就暫時沒有 IP 分組（不是整頁
// 噴錯），跟其他新欄位/新表的既有 fallback 慣例一致。
async function fetchSeriesCategoryRows(): Promise<SupabaseSeriesCategoryRow[]> {
  const rows = await supabaseFetch<SupabaseSeriesCategoryRow[]>(
    "series_categories?select=series_id,categories(name,type,enabled)",
  );
  return rows || [];
}

function seriesIpNamesMap(rows: SupabaseSeriesCategoryRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  rows
    .filter((row) => row.categories?.type === "ip" && row.categories?.enabled !== false && row.categories?.name)
    .forEach((row) => {
      const current = map.get(row.series_id) || [];
      const name = String(row.categories!.name);
      if (!current.includes(name)) current.push(name);
      map.set(row.series_id, current);
    });
  return map;
}

export type PreorderCatalogData = {
  products: PreorderProduct[];
  series: PreorderSeries[];
  ips: PreorderIp[];
};

function earliestDeadline(deadlines: Array<string | null>): string | null {
  const valid = deadlines.filter((value): value is string => Boolean(value));
  if (!valid.length) return null;
  return valid.reduce((earliest, current) => (new Date(current).getTime() < new Date(earliest).getTime() ? current : earliest));
}

export async function getPreorderCatalogData(): Promise<PreorderCatalogData> {
  const [productRows, seriesRows, seriesCategoryRows] = await Promise.all([
    fetchPreorderProductRows(),
    fetchSeriesRows(),
    fetchSeriesCategoryRows(),
  ]);
  const products = productRows.map(mapProductRow);
  const ipNamesBySeriesId = seriesIpNamesMap(seriesCategoryRows);

  const series: PreorderSeries[] = seriesRows.map((row) => {
    const seriesProducts = products.filter((product) => product.seriesId === row.id);
    return {
      id: row.id,
      name: row.name || "",
      coverImageUrl: row.cover_image_url || "",
      sortOrder: Number(row.sort_order ?? 0),
      ipNames: ipNamesBySeriesId.get(row.id) || [],
      deadline: earliestDeadline(seriesProducts.map((product) => product.deadline)),
    };
  });

  const ipSortOrder = new Map<string, number>();
  series.forEach((item, seriesIndex) => {
    item.ipNames.forEach((name) => {
      if (!ipSortOrder.has(name)) ipSortOrder.set(name, seriesIndex);
    });
  });
  const ips: PreorderIp[] = Array.from(new Set(series.flatMap((item) => item.ipNames)))
    .map((name) => ({ name, sortOrder: ipSortOrder.get(name) ?? 9999 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hant"));

  return { products, series, ips };
}

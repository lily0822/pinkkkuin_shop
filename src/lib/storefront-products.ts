import { categories as fallbackCategories, products as fallbackProducts, Product } from "@/lib/products";

type SupabaseProductRow = {
  id: string;
  legacy_id: string | null;
  product_type: "stock" | "preorder";
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number | null;
  stock_quantity: number | null;
  preorder_quota: number | null;
  deadline: string | null;
  status: "active" | "sold_out" | "draft";
  created_at: string;
  updated_at: string;
  product_categories?: Array<{
    categories?: {
      name?: string | null;
    } | null;
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
    ?.map((link) => link.categories?.name)
    .find((name): name is string => Boolean(name));

  if (linkedCategory) return linkedCategory;
  return row.product_type === "preorder" ? "預購商品" : "現貨商品";
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

  return {
    id: row.legacy_id || row.id,
    name_zh: row.name,
    sku: row.legacy_id || row.id,
    price: Number(row.base_price || 0),
    status,
    category: categoryFromRow(row),
    stock_quantity: isPreorder ? row.preorder_quota : row.stock_quantity,
    images: row.image_url ? [row.image_url] : [],
    description: row.description || "",
    source: "Pinkkkuin",
    preorder_note: isPreorder && row.deadline ? `預購截止：${row.deadline}` : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getStorefrontProducts() {
  const select = [
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
    "product_categories(categories(name))",
  ].join(",");

  const rows = await supabaseFetch<SupabaseProductRow[]>(
    `products?select=${encodeURIComponent(select)}&status=in.(active,sold_out)&order=created_at.desc`,
  );

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

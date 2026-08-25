import { getProductById, Product, ProductVariant } from "@/lib/products";

export type ProductGalleryImage = {
  url: string;
  publicId?: string;
  sortOrder: number;
  isPrimary: boolean;
  altText?: string;
};

type SupabaseVariantRow = {
  id: string;
  legacy_id: string | null;
  spec: string | null;
  price: number | null;
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

function normalizeVariants(rows: SupabaseVariantRow[] = []): ProductVariant[] {
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
      stockQuantity: row.stock_quantity,
      productUrl: row.product_url || undefined,
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

  return {
    id: row.legacy_id || row.id,
    name_zh: row.name,
    sku: row.legacy_id || row.id,
    price: Number(row.base_price || 0),
    status,
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

async function getSupabaseProductById(id: string) {
  const select = "id,legacy_id,product_type,name,description,image_url,cost_price,base_price,stock_quantity,preorder_quota,deadline,status,created_at,updated_at,product_variants(id,legacy_id,spec,price,stock_quantity,product_url,status,sort_order)";
  const byLegacyId = await supabaseFetch<SupabaseProductRow[]>(
    `products?select=${encodeURIComponent(select)}&legacy_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (byLegacyId?.[0]) return byLegacyId[0];

  if (!isUuid(id)) return null;
  const byId = await supabaseFetch<SupabaseProductRow[]>(
    `products?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return byId?.[0] || null;
}

export async function getProductDetailById(id: string): Promise<ProductDetailData | null> {
  const staticProduct = getProductById(id);
  const supabaseProduct = await getSupabaseProductById(id);

  if (supabaseProduct) {
    const imageRows = await supabaseFetch<SupabaseImageRow[]>(
      `product_images?select=public_id,secure_url,alt_text,sort_order,is_primary&product_id=eq.${encodeURIComponent(supabaseProduct.id)}&order=sort_order.asc`,
    );
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
    const variants = normalizeVariants(supabaseProduct.product_variants || []);
    const product = mapSupabaseProduct(supabaseProduct, galleryImages, variants);
    return {
      product,
      galleryImages,
    };
  }

  if (!staticProduct) return null;
  const galleryImages = staticGalleryImages(staticProduct);
  return {
    product: staticProduct,
    galleryImages,
  };
}

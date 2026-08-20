export type BrandSettings = {
  storeName: string;
  storeNameEn: string;
  logoUrl: string;
  logoPublicId?: string;
  updatedAt?: string;
};

export const DEFAULT_STORE_NAME = "小企鵝選物";
export const DEFAULT_STORE_NAME_EN = "KOPENGUIN SELECT SHOP";
export const DEFAULT_LOGO_URL = "https://res.cloudinary.com/dhrfwtarc/image/upload/v1782899951/pinkkkuin_logo_q1y5jr.png";

type ScheduleSettingRow = {
  type: string | null;
  image: string | null;
  updated_at: string | null;
};

type LogoLibraryImage = {
  secure_url?: string;
  secureUrl?: string;
  url?: string;
  public_id?: string;
  publicId?: string;
  is_active?: boolean;
  isActive?: boolean;
  sort_order?: number;
  sortOrder?: number;
};

function fallbackBrandSettings(): BrandSettings {
  return {
    storeName: DEFAULT_STORE_NAME,
    storeNameEn: DEFAULT_STORE_NAME_EN,
    logoUrl: DEFAULT_LOGO_URL,
  };
}

function supabaseHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!process.env.SUPABASE_URL?.trim() || !key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function parseBrandJson(value: string | null): Partial<BrandSettings> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return {
      storeName: String(parsed.store_name || parsed.storeName || "").trim() || undefined,
      storeNameEn: String(parsed.store_name_en || parsed.storeNameEn || "").trim() || undefined,
      logoUrl: String(parsed.logo_url || parsed.logoUrl || "").trim() || undefined,
      logoPublicId: String(parsed.logo_public_id || parsed.logoPublicId || "").trim() || undefined,
    };
  } catch {
    return {};
  }
}

function parseLogoLibrary(value: string | null): LogoLibraryImage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const images = Array.isArray(parsed) ? parsed : parsed.images;
    return Array.isArray(images) ? images : [];
  } catch {
    return [];
  }
}

function normalizeBrandSettings(rows: ScheduleSettingRow[] = []): BrandSettings {
  const fallback = fallbackBrandSettings();
  const brandRow = rows.find((row) => row.type === "brand");
  const logoLibraryRow = rows.find((row) => row.type === "brand-logo-library");
  const legacyLogoRow = rows.find((row) => row.type === "brand-logo");
  const parsed = parseBrandJson(brandRow?.image || null);
  const logoLibrary = parseLogoLibrary(logoLibraryRow?.image || null)
    .map((image, index) => ({
      url: String(image.secure_url || image.secureUrl || image.url || "").trim(),
      publicId: String(image.public_id || image.publicId || "").trim(),
      isActive: image.is_active === true || image.isActive === true,
      sortOrder: Number(image.sort_order ?? image.sortOrder ?? index),
    }))
    .filter((image) => image.url)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const activeLogo = logoLibrary.find((image) => image.isActive) || null;

  return {
    storeName: parsed.storeName || fallback.storeName,
    storeNameEn: parsed.storeNameEn || fallback.storeNameEn,
    logoUrl: activeLogo?.url || parsed.logoUrl || legacyLogoRow?.image || fallback.logoUrl,
    logoPublicId: activeLogo?.publicId || parsed.logoPublicId,
    updatedAt: logoLibraryRow?.updated_at || brandRow?.updated_at || legacyLogoRow?.updated_at || undefined,
  };
}

export function cloudinaryTransform(url: string, transformation: string) {
  if (!url.includes("res.cloudinary.com") || !url.includes("/image/upload/")) return url;
  return url.replace("/image/upload/", `/image/upload/${transformation}/`);
}

export async function getBrandSettings(): Promise<BrandSettings> {
  const headers = supabaseHeaders();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!headers || !baseUrl) return fallbackBrandSettings();

  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/schedule_settings?select=type,image,updated_at&type=in.(brand,brand-logo,brand-logo-library)&order=updated_at.desc`,
      {
        headers,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.warn(`Supabase brand settings fetch failed (${response.status})`);
      return fallbackBrandSettings();
    }

    return normalizeBrandSettings((await response.json()) as ScheduleSettingRow[]);
  } catch (error) {
    console.warn("Supabase brand settings fetch failed", error);
    return fallbackBrandSettings();
  }
}

export type BrandSettings = {
  storeName: string;
  logoUrl: string;
  logoPublicId?: string;
  updatedAt?: string;
};

export const DEFAULT_STORE_NAME = "小企鵝選物";
export const DEFAULT_LOGO_URL = "https://res.cloudinary.com/dhrfwtarc/image/upload/v1782899951/pinkkkuin_logo_q1y5jr.png";

type ScheduleSettingRow = {
  type: string | null;
  image: string | null;
  updated_at: string | null;
};

function fallbackBrandSettings(): BrandSettings {
  return {
    storeName: DEFAULT_STORE_NAME,
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
      logoUrl: String(parsed.logo_url || parsed.logoUrl || "").trim() || undefined,
      logoPublicId: String(parsed.logo_public_id || parsed.logoPublicId || "").trim() || undefined,
    };
  } catch {
    return {};
  }
}

function normalizeBrandSettings(rows: ScheduleSettingRow[] = []): BrandSettings {
  const fallback = fallbackBrandSettings();
  const brandRow = rows.find((row) => row.type === "brand");
  const legacyLogoRow = rows.find((row) => row.type === "brand-logo");
  const parsed = parseBrandJson(brandRow?.image || null);

  return {
    storeName: parsed.storeName || fallback.storeName,
    logoUrl: parsed.logoUrl || legacyLogoRow?.image || fallback.logoUrl,
    logoPublicId: parsed.logoPublicId,
    updatedAt: brandRow?.updated_at || legacyLogoRow?.updated_at || undefined,
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
      `${baseUrl}/rest/v1/schedule_settings?select=type,image,updated_at&type=in.(brand,brand-logo)&order=updated_at.desc`,
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

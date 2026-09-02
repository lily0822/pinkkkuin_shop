import "server-only";

type ScheduleSettingRow = {
  image: string | null;
};

function supabaseHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") || "";
  if (!baseUrl || !key) return null;
  return {
    baseUrl,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  };
}

export function isPublicHttpsImageUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function getDefaultProductImageUrl(): Promise<string> {
  const config = supabaseHeaders();
  if (!config) return "";

  try {
    const response = await fetch(
      `${config.baseUrl}/rest/v1/schedule_settings?select=image&type=eq.product-default&limit=1`,
      {
        headers: config.headers,
        cache: "no-store",
      },
    );
    const rows = (await response.json().catch(() => null)) as ScheduleSettingRow[] | null;
    const imageUrl = Array.isArray(rows) ? rows[0]?.image?.trim() || "" : "";
    return isPublicHttpsImageUrl(imageUrl) ? imageUrl : "";
  } catch {
    return "";
  }
}

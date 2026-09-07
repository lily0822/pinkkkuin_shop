export function getSupabasePublicConfig() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim().replace(/\/+$/, "");
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();

  if (!url || !anonKey) {
    throw new Error("Supabase Auth is not configured.");
  }

  return { url, anonKey };
}

export function getSiteOrigin(fallback = "http://127.0.0.1:3000") {
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) return siteUrl.replace(/\/+$/, "");
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;
  return fallback;
}

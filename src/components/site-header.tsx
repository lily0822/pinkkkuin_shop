import { SiteHeaderClient } from "@/components/site-header-client";
import { getBrandSettings } from "@/lib/brand-settings";

export async function SiteHeader() {
  const brand = await getBrandSettings();

  return <SiteHeaderClient brand={brand} />;
}

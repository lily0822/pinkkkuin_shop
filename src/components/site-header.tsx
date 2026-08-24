import { SiteHeaderClient } from "@/components/site-header-client";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { getBrandSettings } from "@/lib/brand-settings";

export async function SiteHeader() {
  const [brand, appearance] = await Promise.all([
    getBrandSettings(),
    getAppearanceSettings(),
  ]);

  return <SiteHeaderClient brand={brand} announcements={appearance.announcements} navigationItems={appearance.navigationItems} />;
}

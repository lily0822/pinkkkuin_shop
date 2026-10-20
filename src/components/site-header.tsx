import { SiteHeaderClient } from "@/components/site-header-client";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { getBrandSettings } from "@/lib/brand-settings";
import { getCachedAuthUser } from "@/lib/supabase/server";

export async function SiteHeader() {
  const [brand, appearance, authResult] = await Promise.all([
    getBrandSettings(),
    getAppearanceSettings(),
    getCachedAuthUser().catch(() => null),
  ]);
  const isMemberLoggedIn = Boolean(authResult?.data.user);

  return (
    <SiteHeaderClient
      brand={brand}
      announcements={appearance.announcements}
      navigationItems={appearance.navigationItems}
      isMemberLoggedIn={isMemberLoggedIn}
    />
  );
}

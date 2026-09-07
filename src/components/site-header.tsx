import { SiteHeaderClient } from "@/components/site-header-client";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { getBrandSettings } from "@/lib/brand-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const [brand, appearance, supabase] = await Promise.all([
    getBrandSettings(),
    getAppearanceSettings(),
    createSupabaseServerClient().catch(() => null),
  ]);
  const userResult = supabase ? await supabase.auth.getUser().catch(() => null) : null;
  const isMemberLoggedIn = Boolean(userResult?.data.user);

  return (
    <SiteHeaderClient
      brand={brand}
      announcements={appearance.announcements}
      navigationItems={appearance.navigationItems}
      isMemberLoggedIn={isMemberLoggedIn}
    />
  );
}

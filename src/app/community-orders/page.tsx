import { CommunityOrdersClient } from "@/components/community-orders-client";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { contactLinks } from "@/lib/site";

export default async function CommunityOrdersPage() {
  const { siteInfo } = await getAppearanceSettings();
  const lineUrl = siteInfo.lineUrl || contactLinks.line;
  return <CommunityOrdersClient lineUrl={lineUrl} />;
}

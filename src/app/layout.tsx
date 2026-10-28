import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { getAppearanceSettings } from "@/lib/appearance-settings";

export const dynamic = "force-dynamic";

const notoSansTc = Noto_Sans_TC({
  variable: "--font-noto-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const fallbackMetadata: Metadata = {
  title: "小企鵝選物 | 日本限定・可愛雜貨代購",
  description: "日本限定、現貨、預購與連線代購選物商城。",
};

export async function generateMetadata(): Promise<Metadata> {
  const { siteInfo } = await getAppearanceSettings();
  const description = siteInfo.description || fallbackMetadata.description || "";
  const ogImage = siteInfo.ogImageUrl ? [{ url: siteInfo.ogImageUrl }] : undefined;

  return {
    ...fallbackMetadata,
    description,
    icons: siteInfo.faviconUrl ? { icon: siteInfo.faviconUrl, shortcut: siteInfo.faviconUrl } : undefined,
    openGraph: {
      title: String(fallbackMetadata.title || ""),
      description,
      images: ogImage,
    },
    twitter: {
      card: "summary_large_image",
      title: String(fallbackMetadata.title || ""),
      description,
      images: siteInfo.ogImageUrl ? [siteInfo.ogImageUrl] : undefined,
    },
  };
}

// 客人專用頁面（/live/*，LIFF 開啟）改用自己的獨立版面（src/app/live/
// layout.tsx）——不渲染這裡定義的網站殼層（CartProvider/
// PreorderListProvider/SiteHeader/SiteFooter/STAGING 徽章/浮動 LINE
// 按鈕）。這支根版面現在只保留 <html>/<body>、字型、全站 metadata
// 這些每個路由都需要的最外層設定；網站本體的殼層搬到
// src/app/(site)/layout.tsx，用 Next.js route group 跟 /live 完全分開
// （route group 的括號資料夾不影響網址，/、/category 等既有網址都不變）。
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className={notoSansTc.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { getBrandSettings, cloudinaryTransform } from "@/lib/brand-settings";

export const dynamic = "force-dynamic";

// 客人專用頁面（LIFF 半屏開啟）的獨立版面——完全不渲染網站殼層
// （src/app/(site)/layout.tsx 的 CartProvider/PreorderListProvider/
// SiteHeader/SiteFooter/STAGING 徽章/浮動 LINE 按鈕），因為這裡是
// route group 以外的另一個分支，那些 Provider 跟它們各自在掛載時打的
// 請求（購物車/會員/預購清單）完全不會進到這個元件樹。
//
// 不用 noindex 的 <meta> 額外加 X-Robots-Tag 回應標頭——後者在
// middleware.ts 針對 /live 開頭的路徑統一加，meta 這裡負責的是頁面層級
// 這份、給直接讀 HTML 的爬蟲用；兩者雙保險。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LiveLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await getBrandSettings();
  const logoUrl = brand.logoUrl ? cloudinaryTransform(brand.logoUrl, "f_auto,q_auto,w_240,c_limit") : "";

  return (
    <div className="min-h-screen bg-white">
      {/* LOGO 區高度刻意壓在 56px 以內——LIFF Tall 半屏可用高度有限，
          商品列表至少要能一次看到 3 筆，不能被頭部擠壓太多。不可點擊、
          不連到網站首頁，客人不該發現背後有個網站。

          刻意忽略網站標頭用的 logoScale/logoPositionX/logoPositionY——
          那組設定是為了網站標頭「固定裁切框」設計的放大/位移，這裡沒有
          裁切框可以配合，套用同一組設定反而會把圖片推出可視範圍、頂端
          被切掉。客人頁面固定用 object-contain 完整顯示整張圖，不做任何
          縮放/位移。 */}
      <div className="flex items-center justify-center" style={{ height: 56 }} aria-hidden={!logoUrl}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${brand.storeName} LOGO`} className="h-12 max-h-full w-auto object-contain" />
        ) : null}
      </div>
      {children}
    </div>
  );
}

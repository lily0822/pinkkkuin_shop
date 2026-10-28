import { CartProvider } from "@/components/cart-provider";
import { PreorderListProvider } from "@/components/preorder-list-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StagingBadge } from "@/components/staging-badge";
import { getPreorderAccess } from "@/lib/member/preorder-access";

// 原本在根版面（src/app/layout.tsx）上——搬到這裡是因為 force-dynamic
// 的理由（getPreorderAccess() 需要每次請求都重新驗證）只跟網站本體有
// 關，/live/* 頁面各自已經有自己的 force-dynamic（見 src/app/live/
// confirm/page.tsx、orders/page.tsx），不依賴這裡。
export const dynamic = "force-dynamic";

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PreorderListProvider 要靠這個決定要不要在客戶端打請求（見「不必要的
  // 請求」那一輪）——用的是 cache() 包過的 getPreorderAccess()，跟
  // site-header.tsx/首頁/分類頁/商品詳情頁各自呼叫的是同一份快取結果，
  // 不會變成這個請求多一次重複的驗證/查詢。
  const preorderAccess = await getPreorderAccess();

  return (
    <PreorderListProvider initialAccess={preorderAccess}>
      <CartProvider>
        <StagingBadge />
        <SiteHeader />
        {children}
        <SiteFooter />
        <a
          href="https://line.me/R/ti/p/@pinkkkuin"
          className="fixed bottom-4 left-4 z-40 rounded-full border-2 border-white bg-[#06C755] px-4 py-2.5 text-xs font-black text-white shadow-lg transition hover:scale-105 sm:text-sm"
        >
          LINE 小企鵝
        </a>
      </CartProvider>
    </PreorderListProvider>
  );
}

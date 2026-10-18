import { LiveMarketInfo } from "@/components/live-market-info";
import { FeatureDisabledNotice } from "@/components/feature-disabled-notice";
import { PreorderAccessGate } from "@/components/preorder-access-gate";
import { PreorderCatalog } from "@/components/preorder-catalog";
import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { getPreorderAccess } from "@/lib/member/preorder-access";
import { ProductStatus, statusLabels } from "@/lib/products";
import { getDisabledMessage, getSiteFeatureFlag, isEffectivelyEnabled, SiteFeatureFlag } from "@/lib/site-feature-flags";
import { getPreorderCatalogData } from "@/lib/storefront-preorder";
import { getPublicSchedules } from "@/lib/storefront-schedules";
import { getStorefrontCategories, getStorefrontProducts } from "@/lib/storefront-products";

const statusSlugs: ProductStatus[] = ["in_stock", "preorder", "live_order", "sold_out", "restocking"];

const slugFeatureFlags: Record<string, SiteFeatureFlag> = {
  preorder: "preorder",
  in_stock: "stock",
  live_order: "live_order",
};

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);

  const flagKey = slugFeatureFlags[decodedSlug];
  if (flagKey) {
    const flag = await getSiteFeatureFlag(flagKey);
    if (!isEffectivelyEnabled(flag)) {
      return (
        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <FeatureDisabledNotice title="此分類暫未開放" message={getDisabledMessage(flag)} />
        </main>
      );
    }
  }

  if (decodedSlug === "live_order") {
    const schedules = await getPublicSchedules();
    return <LiveMarketInfo connections={schedules.connections} stalls={schedules.stalls} />;
  }

  // /category/preorder 系列管理改版：這個分類改用專門的資料讀取
  // （getPreorderCatalogData，只查 product_type=preorder 的 active 商品）
  // 跟專門的 UI（PreorderCatalog），不是 ProductCatalog 的 denseCategoryLayout
  // 分支——版面/互動（系列 banner、IP 篩選、倒數徽章等）跟其他分類頁完全
  // 不一樣，硬塞進共用元件只會讓那個元件長滿一堆只有這個分類會用到的
  // 條件分支。
  if (decodedSlug === "preorder") {
    // 第三期前台門禁：資格判斷要在拿到任何預購商品資料之前先做完——
    // 沒有資格的話，連 getPreorderCatalogData() 都不呼叫（商品/系列
    // 資料完全不會進到這支 server component 的記憶體裡，更不可能被
    // 序列化成任何 client component 的 props），直接回門禁提示畫面。
    const access = await getPreorderAccess();
    if (!access.hasAccess) {
      return (
        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <PreorderAccessGate access={access} returnTo="/category/preorder" />
        </main>
      );
    }

    const catalog = await getPreorderCatalogData();
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <SectionHeading title="預購" description="依系列快速瀏覽目前可預購的商品。" />
        <div className="mt-6">
          <PreorderCatalog {...catalog} />
        </div>
      </main>
    );
  }

  const products = await getStorefrontProducts();
  const categories = await getStorefrontCategories();
  const isStatus = statusSlugs.includes(decodedSlug as ProductStatus);
  const isCategory = categories.includes(decodedSlug);
  const useDenseCategoryLayout = decodedSlug === "preorder" || decodedSlug === "in_stock";
  const title = decodedSlug === "in_stock" ? "現貨" : isStatus ? `${statusLabels[decodedSlug as ProductStatus]}商品` : decodedSlug;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionHeading
        title={title}
        description={isCategory ? "依分類快速瀏覽目前可選購的商品。" : "依商品狀態瀏覽目前上架的選物。"}
      />
      <div className="mt-6">
        <ProductCatalog
          products={products}
          initialStatus={isStatus ? (decodedSlug as ProductStatus) : "all"}
          initialCategory={isCategory ? decodedSlug : "all"}
          denseCategoryLayout={useDenseCategoryLayout}
        />
      </div>
    </main>
  );
}

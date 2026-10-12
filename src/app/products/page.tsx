import { FeatureDisabledNotice } from "@/components/feature-disabled-notice";
import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { getDisabledMessage, getSiteFeatureFlag, isEffectivelyEnabled } from "@/lib/site-feature-flags";
import { getStorefrontProducts } from "@/lib/storefront-products";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const productsFlag = await getSiteFeatureFlag("products");
  if (!isEffectivelyEnabled(productsFlag)) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <FeatureDisabledNotice title="商品頁暫未開放" message={getDisabledMessage(productsFlag)} />
      </main>
    );
  }

  const params = await searchParams;
  const storefrontProducts = await getStorefrontProducts();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionHeading
        title="全部商品"
        description="從日本限定、現貨商品到連線預購都整理在這裡。列表只載入主圖，詳細頁才會載入完整商品圖片 Gallery。"
      />
      <div className="mt-6">
        <ProductCatalog products={storefrontProducts} initialQuery={params.q || ""} denseCategoryLayout />
      </div>
    </main>
  );
}

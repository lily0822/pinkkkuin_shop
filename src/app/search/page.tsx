import { FeatureDisabledNotice } from "@/components/feature-disabled-notice";
import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { getPreorderAccess } from "@/lib/member/preorder-access";
import { getDisabledMessage, getSiteFeatureFlag, isEffectivelyEnabled } from "@/lib/site-feature-flags";
import { getStorefrontProducts } from "@/lib/storefront-products";

// 預購獨立流程 第三期：獨立的搜尋結果頁，故意沒有放進導覽選單
// （site-header-client.tsx 的搜尋表單會導到這裡，但這個路由不會出現在
// 任何導覽清單裡），只有打字搜尋才會到。跟 /products 分開的理由：這裡
// 要套用預購門禁，/products 目前還沒有（移除/改造 /products 是另一輪
// 的範圍，這次不動它，但也沒有把搜尋導過去，不讓新的搜尋入口繼續依賴
// 那個還沒做門禁的頁面）。
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const productsFlag = await getSiteFeatureFlag("products");
  if (!isEffectivelyEnabled(productsFlag)) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <FeatureDisabledNotice title="搜尋功能暫未開放" message={getDisabledMessage(productsFlag)} />
      </main>
    );
  }

  const params = await searchParams;
  const query = params.q || "";

  // 資格判斷要在拿到商品資料之後、傳進 ProductCatalog（client
  // component）之前就先把預購商品濾掉——沒有資格的訪客，搜尋結果裡
  // 從一開始就不會有任何預購商品的資料進到這支 server component 要
  // 傳出去的 props 裡，不是搜出來再靠前端判斷隱藏。
  const [access, allProducts] = await Promise.all([getPreorderAccess(), getStorefrontProducts()]);
  const products = access.hasAccess ? allProducts : allProducts.filter((product) => product.productType !== "preorder");

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionHeading
        title="搜尋結果"
        description={query ? `「${query}」的搜尋結果` : "輸入關鍵字搜尋商品名稱、角色、SKU 或分類。"}
      />
      <div className="mt-6">
        <ProductCatalog products={products} initialQuery={query} denseCategoryLayout />
      </div>
    </main>
  );
}

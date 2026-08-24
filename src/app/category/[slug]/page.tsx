import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { ProductStatus, statusLabels } from "@/lib/products";
import { getStorefrontCategories, getStorefrontProducts } from "@/lib/storefront-products";

const statusSlugs: ProductStatus[] = ["in_stock", "preorder", "live_order", "sold_out", "restocking"];

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const products = await getStorefrontProducts();
  const categories = await getStorefrontCategories();
  const isStatus = statusSlugs.includes(decodedSlug as ProductStatus);
  const isCategory = categories.includes(decodedSlug);
  const useDenseCategoryLayout = decodedSlug === "preorder" || decodedSlug === "in_stock";
  const title = isStatus ? `${statusLabels[decodedSlug as ProductStatus]}商品` : decodedSlug;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Category"
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

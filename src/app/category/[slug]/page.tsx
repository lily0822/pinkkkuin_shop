import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { categories, products, ProductStatus, statusLabels } from "@/lib/products";

const statusSlugs: ProductStatus[] = ["in_stock", "preorder", "live_order", "sold_out", "restocking"];

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const isStatus = statusSlugs.includes(decodedSlug as ProductStatus);
  const isCategory = categories.includes(decodedSlug);
  const title = isStatus ? `${statusLabels[decodedSlug as ProductStatus]}商品` : decodedSlug;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Category"
        title={title}
        description={isCategory ? "依角色 / 品牌分類瀏覽商品，也可以再使用搜尋、狀態與價格篩選。" : "依販售狀態瀏覽商品，也可以再使用搜尋、分類與價格篩選。"}
      />
      <div className="mt-7">
        <ProductCatalog
          products={products}
          initialStatus={isStatus ? (decodedSlug as ProductStatus) : "all"}
          initialCategory={isCategory ? decodedSlug : "all"}
        />
      </div>
    </main>
  );
}

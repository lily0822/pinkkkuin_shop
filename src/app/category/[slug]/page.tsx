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
  const title = isStatus ? `${statusLabels[decodedSlug as ProductStatus]}商品` : decodedSlug;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Category"
        title={title}
        description={
          isCategory
            ? "依分類整理目前可詢問與購買的日本選物。"
            : "依商品狀態快速查看現貨、預購、連線與補貨商品。"
        }
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

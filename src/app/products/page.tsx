import { ProductCatalog } from "@/components/product-catalog";
import { SectionHeading } from "@/components/section-heading";
import { products } from "@/lib/products";

export default function ProductsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Catalog"
        title="商品總覽"
        description="搜尋商品名稱、日文名稱、SKU、角色或分類，並依狀態、分類與價格快速篩選。"
      />
      <div className="mt-7">
        <ProductCatalog products={products} />
      </div>
    </main>
  );
}

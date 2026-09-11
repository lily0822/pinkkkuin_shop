import Link from "next/link";
import { CalendarDays, Search, WandSparkles } from "lucide-react";
import { HomeBannerCarousel } from "@/components/home-banner-carousel";
import { ProductCard } from "@/components/product-card";
import { getAppearanceSettings, type HomepageSection } from "@/lib/appearance-settings";
import { getStorefrontProducts } from "@/lib/storefront-products";
import type { Product } from "@/lib/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SectionRendererProps = {
  section: HomepageSection;
  products: Product[];
};

function sectionLimit(section: HomepageSection) {
  return Math.max(1, Math.min(24, Number(section.maxItems) || 6));
}

function SectionHeader({ section, href }: { section: HomepageSection; href?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-penguin-pink-dark">Pinkkkuin</p>
        <h2 className="text-2xl font-black text-penguin-gray">{section.title}</h2>
      </div>
      {href ? (
        <Link href={href} className="hidden rounded-full bg-white px-4 py-2 text-sm font-black text-penguin-pink-dark shadow-sm sm:inline-flex">
          查看全部
        </Link>
      ) : null}
    </div>
  );
}

function ProductGridSection({ section, products, href }: { section: HomepageSection; products: Product[]; href: string }) {
  const visibleProducts = products.slice(0, sectionLimit(section));
  if (!visibleProducts.length) return null;

  return (
    <section>
      <SectionHeader section={section} href={href} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {visibleProducts.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

function ShoppingGuideSection({ section }: { section: HomepageSection }) {
  const steps = ["挑選商品", "加入購物車", "透過 LINE / IG 確認", "完成付款", "等待日本寄回"].slice(0, sectionLimit(section));
  return (
    <section className="rounded-3xl border-4 border-penguin-pink bg-white p-6 shadow-lg">
      <div className="flex items-center gap-3">
        <CalendarDays className="text-penguin-pink-dark" size={24} />
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-penguin-pink-dark">Shopping Guide</p>
          <h2 className="text-xl font-black text-penguin-gray">{section.title}</h2>
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step} className="rounded-2xl bg-penguin-pink-light p-4">
            <p className="text-xs font-black text-penguin-pink-dark">STEP {index + 1}</p>
            <p className="mt-2 text-sm font-black text-penguin-gray">{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function renderConfiguredSection({ section, products }: SectionRendererProps) {
  if (!section.enabled) return null;

  if (section.id === "category_shortcuts") return null;
  if (section.id === "latest") return <ProductGridSection section={section} products={products} href="/products" />;
  if (section.id === "stock") {
    return <ProductGridSection section={section} products={products.filter((product) => product.status === "in_stock" || product.status === "sold_out")} href="/category/in_stock" />;
  }
  if (section.id === "preorder") {
    return <ProductGridSection section={section} products={products.filter((product) => product.status === "preorder" || product.category === "預購商品")} href="/category/preorder" />;
  }
  if (section.id === "guide") return <ShoppingGuideSection section={section} />;

  return null;
}

export default async function HomePage() {
  const [appearance, products] = await Promise.all([
    getAppearanceSettings(),
    getStorefrontProducts(),
  ]);

  return (
    <main className="space-y-10 py-6">
      <h1 className="sr-only">小企鵝選物</h1>
      <HomeBannerCarousel banners={appearance.banners} />

      <div className="mx-auto max-w-7xl space-y-10 px-4">
        {appearance.homepageSections
          .filter((section) => section.enabled && section.id !== "category_shortcuts")
          .map((section) => (
            <div key={section.id}>{renderConfiguredSection({ section, products })}</div>
          ))}

        <section className="grid gap-5 lg:grid-cols-12">
          <aside className="space-y-5 lg:col-span-3">
            <div className="rounded-3xl border-4 border-yellow-300 bg-penguin-yellow p-5 shadow-xl">
              <div className="space-y-1 text-center">
                <span className="text-3xl">💌</span>
                <h2 className="text-base font-black text-penguin-gray">幫我找日本商品</h2>
                <p className="text-[11px] leading-5 text-gray-500">找不到想要的角色或限定款，也可以傳圖讓小企鵝幫你詢價。</p>
              </div>
              <Link
                href="/contact"
                className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-penguin-pink-dark shadow-sm"
              >
                <WandSparkles size={17} />
                聯絡小企鵝
              </Link>
            </div>
          </aside>

          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-md lg:col-span-9">
            <h2 className="flex items-center gap-2 text-base font-black text-penguin-gray">
              <Search size={18} className="text-penguin-pink-dark" />
              快速搜尋
            </h2>
            <p className="mt-3 text-xs leading-6 text-gray-500">
              可以搜尋角色、品牌、商品名稱或分類。商品列表只載入主圖，商品詳細頁才會載入完整 Gallery。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

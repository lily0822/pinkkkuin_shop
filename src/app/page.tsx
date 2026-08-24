import Link from "next/link";
import { ArrowRight, CalendarDays, Search, Sparkles, WandSparkles } from "lucide-react";
import { HomeBannerCarousel } from "@/components/home-banner-carousel";
import { ProductCard } from "@/components/product-card";
import { getAppearanceSettings, type HomepageSection } from "@/lib/appearance-settings";
import { getStorefrontCategories, getStorefrontProducts } from "@/lib/storefront-products";
import type { Product } from "@/lib/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SectionRendererProps = {
  section: HomepageSection;
  products: Product[];
  categories: string[];
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

function CategoryShortcutSection({ section, categories }: { section: HomepageSection; categories: string[] }) {
  const quickCategories = [
    { label: "首頁", href: "/" },
    { label: "預購商品", href: "/category/preorder" },
    { label: "現貨商品", href: "/category/in_stock" },
    { label: "連線 / 擺攤", href: "/category/live_order" },
    { label: "購物須知", href: "/guide" },
    ...categories.slice(0, Math.max(0, sectionLimit(section) - 5)).map((category) => ({
      label: category,
      href: `/category/${encodeURIComponent(category)}`,
    })),
  ].slice(0, sectionLimit(section));

  return (
    <section aria-label={section.title} className="nav-scrollbar flex gap-2 overflow-x-auto rounded-3xl bg-penguin-pink-light/80 p-3 text-sm font-bold shadow-sm">
      {quickCategories.map((category) => (
        <Link key={category.href} href={category.href} className="category-tab shrink-0 snap-start">
          {category.label}
        </Link>
      ))}
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

function renderConfiguredSection({ section, products, categories }: SectionRendererProps) {
  if (!section.enabled) return null;

  if (section.id === "category_shortcuts") return <CategoryShortcutSection section={section} categories={categories} />;
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
  const [appearance, products, storefrontCategories] = await Promise.all([
    getAppearanceSettings(),
    getStorefrontProducts(),
    getStorefrontCategories(),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-12 px-4 py-6">
      <HomeBannerCarousel banners={appearance.banners} />

      <section className="cute-bounce relative overflow-hidden rounded-3xl border-4 border-penguin-peach-dark bg-gradient-to-b from-penguin-peach to-white p-6 shadow-lg md:p-10">
        <div className="cloud-animate absolute left-6 top-4 text-4xl text-white/70">☁</div>
        <div className="cloud-animate absolute bottom-8 right-12 text-5xl text-white/70" style={{ animationDelay: "-6s" }}>
          ☁
        </div>

        <div className="relative z-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          <div className="space-y-4 text-center lg:col-span-7 lg:text-left">
            <span className="inline-block animate-bounce rounded-full border-2 border-penguin-pink-dark bg-white px-3 py-1 text-xs font-bold text-penguin-pink-dark">
              Tokyo Sweet Live
            </span>
            <h1 className="text-3xl font-black leading-tight text-penguin-gray md:text-5xl">
              小企鵝日本代購
              <span className="text-penguin-pink-dark underline decoration-pink-300 decoration-wavy"> 即時連線中！</span>
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-8 text-gray-500 md:text-base lg:mx-0">
              從日本現場幫你找可愛雜貨、限定小物與療癒角色商品。商品資料統一讀取 Supabase，圖片由 Cloudinary 最佳化顯示。
            </p>
            <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 rounded-full bg-penguin-pink-dark px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink"
              >
                開始逛商品
                <ArrowRight size={17} />
              </Link>
              <Link
                href="/category/preorder"
                className="inline-flex items-center gap-2 rounded-full border-2 border-penguin-pink bg-white px-5 py-3 text-sm font-black text-penguin-pink-dark shadow-sm"
              >
                看預購新品
                <Sparkles size={17} />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="relative mx-auto max-w-sm rounded-[2rem] border-4 border-white bg-white/75 p-5 text-center shadow-xl backdrop-blur">
              <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-penguin-yellow text-6xl shadow-inner">
                🐧
              </div>
              <p className="mt-5 text-2xl font-black text-penguin-gray">Pinkkkuin Select</p>
              <p className="mt-2 text-sm font-bold text-gray-500">日本限定・現貨・預購・連線代購</p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-xs font-black">
                <span className="rounded-2xl bg-penguin-pink-light px-3 py-2 text-penguin-pink-dark">現貨</span>
                <span className="rounded-2xl bg-penguin-yellow px-3 py-2 text-penguin-gray">預購</span>
                <span className="rounded-2xl bg-penguin-peach px-3 py-2 text-penguin-gray">連線</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {appearance.homepageSections.map((section) => (
        <div key={section.id}>{renderConfiguredSection({ section, products, categories: storefrontCategories })}</div>
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
    </main>
  );
}

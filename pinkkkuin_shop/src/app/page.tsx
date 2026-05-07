import Link from "next/link";
import { ArrowRight, Megaphone, MessageCircle, Sparkles } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SectionHeading } from "@/components/section-heading";
import { categories, getFeaturedProducts } from "@/lib/products";
import { announcements, contactLinks } from "@/lib/site";

const quickCategories = [
  { label: "現貨商品", href: "/category/in_stock" },
  { label: "預購商品", href: "/category/preorder" },
  { label: "連線商品", href: "/category/live_order" },
  ...categories.map((category) => ({ label: category, href: `/category/${encodeURIComponent(category)}` })),
];

export default function HomePage() {
  const featuredProducts = getFeaturedProducts();

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:px-8 lg:py-16">
        <div className="flex flex-col justify-center">
          <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-brand-pink-dark shadow-sm">
            <Sparkles size={15} />
            日本可愛雜貨・角色商品代購
          </p>
          <h1 className="text-4xl font-black leading-tight sm:text-6xl">
            Pinkkkuin
            <span className="block text-brand-pink-dark">小企鵝選物</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-muted sm:text-lg">
            收集ちいかわ、Sanrio、Disney、Pokémon、Pikmin 與日本日常雜貨。先看型錄，再透過 IG 或 LINE 私訊確認庫存與下單。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-black text-white"
            >
              瀏覽所有商品
              <ArrowRight size={17} />
            </Link>
            <Link
              href={contactLinks.line}
              className="inline-flex items-center gap-2 rounded-full bg-brand-mint px-5 py-3 text-sm font-black"
            >
              <MessageCircle size={17} />
              LINE 詢問
            </Link>
          </div>
        </div>
        <div className="relative min-h-[320px] overflow-hidden rounded-[8px] border border-border bg-white p-5 shadow-xl shadow-pink-100">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#ffe2eb_0%,#fff7d6_48%,#dff6fb_100%)]" />
          <div className="relative grid h-full place-items-center rounded-[8px] border border-white/70 bg-white/45 p-6 text-center backdrop-blur-sm">
            <div>
              <div className="mx-auto grid size-28 place-items-center rounded-full bg-white text-5xl font-black text-brand-pink-dark shadow-sm">
                P
              </div>
              <p className="mt-6 text-2xl font-black">Pinkkkuin Select</p>
              <p className="mt-2 text-sm font-bold text-muted">手帳感、貼紙感、可愛但乾淨的小企鵝商品型錄</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="News" title="最新公告" />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="rounded-[8px] border border-border bg-white p-5">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-1 text-brand-pink-dark" size={20} />
                <div>
                  <h3 className="font-black">{announcement.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted">{announcement.content}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <SectionHeading title="商品分類入口" description="依販售狀態、角色與品牌快速找到想看的商品。" />
        <div className="mt-5 flex flex-wrap gap-2">
          {quickCategories.map((category) => (
            <Link
              key={category.href}
              href={category.href}
              className="rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-muted transition hover:border-brand-pink hover:text-brand-pink-dark"
            >
              {category.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading title="熱門商品 / 推薦商品" description="目前推薦的現貨、預購與連線商品。" />
          <Link href="/products" className="hidden text-sm font-black text-brand-pink-dark sm:inline-flex">
            查看全部
          </Link>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {featuredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-[8px] border border-border bg-white p-6">
          <SectionHeading title="下單流程" description="初期採私訊確認庫存與金額，付款後安排出貨。" />
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {["選擇商品", "複製名稱或截圖", "私訊 IG / LINE", "確認庫存與金額", "付款後安排出貨"].map(
              (step, index) => (
                <div key={step} className="rounded-[8px] bg-pink-50 p-4">
                  <p className="text-xs font-black text-brand-pink-dark">STEP {index + 1}</p>
                  <p className="mt-2 text-sm font-black">{step}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

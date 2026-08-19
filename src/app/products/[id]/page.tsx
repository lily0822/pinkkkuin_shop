import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, MessageCircle } from "lucide-react";
import { CopyProductButton } from "@/components/copy-product-button";
import { ProductGallery } from "@/components/product-gallery";
import { formatPrice, products, statusLabels, statusStyles } from "@/lib/products";
import { getProductDetailById } from "@/lib/product-detail";
import { contactLinks } from "@/lib/site";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return products.map((product) => ({ id: product.id }));
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getProductDetailById(id);

  if (!detail) {
    notFound();
  }

  const { product, galleryImages } = detail;

  const rows = [
    ["商品日文名稱", product.name_jp],
    ["商品編號", product.sku],
    ["分類", product.category],
    ["品牌 / 角色", product.brand],
    ["尺寸", product.size],
    ["材質", product.material],
    ["來源", product.source],
    ["庫存", product.stock_quantity == null ? "請私訊確認" : `${product.stock_quantity} 件`],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/products" className="text-sm font-black text-brand-pink-dark">
        返回商品總覽
      </Link>
      <div className="mt-6 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <ProductGallery images={galleryImages} productName={product.name_zh} />
        <section className="space-y-6">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-black ${statusStyles[product.status]}`}>
                {statusLabels[product.status]}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-600">
                {product.category}
              </span>
            </div>
            <h1 className="text-3xl font-black leading-tight sm:text-4xl">{product.name_zh}</h1>
            {product.name_jp ? <p className="mt-3 text-sm font-bold text-muted">{product.name_jp}</p> : null}
            <p className="mt-5 text-3xl font-black text-brand-pink-dark">
              {product.status === "sold_out" ? "已售完" : product.status === "preorder" ? `預購價：${formatPrice(product.price)}` : formatPrice(product.price)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <CopyProductButton product={product} />
            <Link
              href={contactLinks.line}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-mint px-5 text-sm font-black"
            >
              <MessageCircle size={17} />
              LINE 詢問
            </Link>
            <Link
              href={contactLinks.instagram}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-pink px-5 text-sm font-black text-white"
            >
              <Camera size={17} />
              IG 私訊
            </Link>
          </div>

          <div className="rounded-[8px] border border-border bg-white p-5">
            <h2 className="text-lg font-black">商品說明</h2>
            <p className="mt-3 text-sm leading-7 text-muted">{product.description}</p>
          </div>

          <div className="rounded-[8px] border border-border bg-white p-5">
            <h2 className="text-lg font-black">商品資訊</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="rounded-[8px] bg-stone-50 p-3">
                  <dt className="text-xs font-black text-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {product.preorder_note || product.notice ? (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-lg font-black">注意事項</h2>
              {product.preorder_note ? <p className="mt-3 text-sm leading-7">{product.preorder_note}</p> : null}
              {product.notice ? <p className="mt-2 text-sm leading-7">{product.notice}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

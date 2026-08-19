import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, MessageCircle } from "lucide-react";
import { AddToCartButton } from "@/components/add-to-cart-button";
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

  const priceLabel =
    product.status === "sold_out"
      ? "已售完"
      : product.status === "preorder"
        ? `預購價 ${formatPrice(product.price)}`
        : formatPrice(product.price);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/products"
        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-penguin-pink-dark shadow-sm"
      >
        <ArrowLeft size={16} />
        回商品總覽
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <ProductGallery images={galleryImages} productName={product.name_zh} />

        <section className="space-y-6">
          <div className="rounded-3xl border-4 border-white bg-white/90 p-5 shadow-xl">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-black ${statusStyles[product.status]}`}>
                {statusLabels[product.status]}
              </span>
              <span className="rounded-full bg-penguin-peach-light px-3 py-1 text-xs font-black text-penguin-gray">
                {product.category}
              </span>
            </div>
            <h1 className="text-3xl font-black leading-tight text-penguin-gray sm:text-4xl">{product.name_zh}</h1>
            {product.name_jp ? <p className="mt-3 text-sm font-bold text-gray-500">{product.name_jp}</p> : null}
            <p className="mt-5 text-3xl font-black text-penguin-pink-dark">{priceLabel}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <AddToCartButton product={product} />
            <CopyProductButton product={product} />
            <Link
              href={contactLinks.line}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#B7E4D0] px-5 text-sm font-black text-penguin-gray shadow-sm"
            >
              <MessageCircle size={17} />
              LINE 詢問
            </Link>
          </div>

          <Link
            href={contactLinks.instagram}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-penguin-pink bg-white px-5 text-sm font-black text-penguin-pink-dark shadow-sm sm:w-auto"
          >
            <Camera size={17} />
            到 Instagram 看連線
          </Link>

          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-penguin-gray">商品說明</h2>
            <p className="mt-3 text-sm leading-7 text-gray-500">{product.description}</p>
          </div>

          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-penguin-gray">商品資訊</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-penguin-pink-light/70 p-3">
                  <dt className="text-xs font-black text-penguin-pink-dark">{label}</dt>
                  <dd className="mt-1 text-sm font-bold text-penguin-gray">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {product.preorder_note || product.notice ? (
            <div className="rounded-3xl border-2 border-yellow-300 bg-penguin-yellow p-5 shadow-sm">
              <h2 className="text-lg font-black text-penguin-gray">購買提醒</h2>
              {product.preorder_note ? <p className="mt-3 text-sm leading-7 text-gray-600">{product.preorder_note}</p> : null}
              {product.notice ? <p className="mt-2 text-sm leading-7 text-gray-600">{product.notice}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

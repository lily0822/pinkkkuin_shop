import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CopyProductButton } from "@/components/copy-product-button";
import { FeatureDisabledNotice } from "@/components/feature-disabled-notice";
import { ProductGallery } from "@/components/product-gallery";
import { statusLabels, statusStyles, type Product } from "@/lib/products";
import { getProductDetailById } from "@/lib/product-detail";
import { contactLinks } from "@/lib/site";
import { getDisabledMessage, getSiteFeatureFlag, isEffectivelyEnabled } from "@/lib/site-feature-flags";

export const dynamic = "force-dynamic";

// products 是最上層的全域開關；再依商品本身的類型（現貨/預購）各自
// 檢查對應的開關。live_order（代購/市集）目前沒有任何商品被歸類在
// 底下，不在這裡的判斷範圍內。
async function getBlockingFeatureFlag(product: Product) {
  const productsFlag = await getSiteFeatureFlag("products");
  if (!isEffectivelyEnabled(productsFlag)) return productsFlag;

  const productType = product.category === "預購商品" ? "preorder" : "stock";
  const typeFlag = await getSiteFeatureFlag(productType);
  if (!isEffectivelyEnabled(typeFlag)) return typeFlag;

  return null;
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getProductDetailById(id);

  if (!detail) {
    notFound();
  }

  const { product, galleryImages } = detail;

  const blockingFlag = await getBlockingFeatureFlag(product);
  if (blockingFlag) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <FeatureDisabledNotice title="此商品暫未開放瀏覽" message={getDisabledMessage(blockingFlag)} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/products"
        className="ml-24 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-penguin-pink-dark shadow-sm sm:ml-0"
      >
        <ArrowLeft size={16} />
        回到商品列表
      </Link>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.6fr)_minmax(360px,0.4fr)] lg:gap-8">
        <ProductGallery images={galleryImages} productName={product.name_zh} />

        <section className="space-y-4">
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
          </div>

          <AddToCartButton product={product} />

          <div className="grid gap-3 sm:grid-cols-2">
            <CopyProductButton product={product} />
            <Link
              href={contactLinks.line}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#B7E4D0] px-5 text-sm font-black text-penguin-gray shadow-sm"
            >
              <MessageCircle size={17} />
              LINE 詢問
            </Link>
          </div>

          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-lg font-black text-penguin-gray">商品描述</h2>
            <p className="mt-3 text-sm leading-7 text-gray-500">{product.description}</p>
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

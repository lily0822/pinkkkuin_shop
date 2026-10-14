"use client";

import { ReactNode, useState } from "react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductGallery } from "@/components/product-gallery";
import type { ProductGalleryImage } from "@/lib/product-detail";
import type { Product } from "@/lib/products";

type ProductDetailInteractiveProps = {
  product: Product;
  galleryImages: ProductGalleryImage[];
  // 標題卡片跟「加入購物車」卡片以外的其餘內容（複製連結/LINE詢問、
  // 商品描述、購買提醒等）還是由 page.tsx 這個 Server Component 直接
  // 寫 JSX 傳進來當 children，不用整段搬進這個 Client Component——只有
  // 真的需要共享「目前選中規格」這個 state 的 ProductGallery 跟
  // AddToCartButton 兩個才需要被這層包住。
  titleCard: ReactNode;
  children: ReactNode;
};

// 把 ProductGallery 跟 AddToCartButton 包在同一個 Client Component 裡，
// 共享「目前選中規格」這個 state：客人在 AddToCartButton 點規格時，
// ProductGallery 才能知道要不要自動切到該規格的專屬圖片。
export function ProductDetailInteractive({ product, galleryImages, titleCard, children }: ProductDetailInteractiveProps) {
  const [activeVariantId, setActiveVariantId] = useState<string | undefined>(undefined);

  return (
    <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.46fr)_minmax(360px,0.54fr)] lg:gap-8">
      <ProductGallery key={product.id} images={galleryImages} productName={product.name_zh} activeVariantId={activeVariantId} />

      <section className="space-y-4">
        {titleCard}
        <AddToCartButton product={product} onVariantChange={setActiveVariantId} />
        {children}
      </section>
    </div>
  );
}

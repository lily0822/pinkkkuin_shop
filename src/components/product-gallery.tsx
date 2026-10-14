"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductGalleryImage } from "@/lib/product-detail";

type ProductGalleryProps = {
  images: ProductGalleryImage[];
  productName: string;
  // 客人點選規格時，如果該規格有專屬圖片就自動切過去；沒有專屬圖片
  // 大圖維持現狀不跳動（商品共用圖片隨時都能手動瀏覽，不受這個影響）。
  activeVariantId?: string;
};

function cloudinaryImageUrl(image: string, width: number) {
  if (!image.includes("/res.cloudinary.com/") || !image.includes("/upload/")) return image;
  return image.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
}

function primaryIndex(images: ProductGalleryImage[]) {
  const index = images.findIndex((image) => image.isPrimary);
  return index >= 0 ? index : 0;
}

export function ProductGallery({ images, productName, activeVariantId }: ProductGalleryProps) {
  const galleryImages = useMemo(() => images.filter((image) => image.url), [images]);
  const [selectedIndex, setSelectedIndex] = useState(() => primaryIndex(galleryImages));
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const hasMultipleImages = galleryImages.length > 1;

  // 這裡改成由外層（ProductDetailInteractive）在 <ProductGallery key={product.id}>
  // 加 key，換商品時整個元件連同這個 state 一起重新掛載，不需要再靠
  // effect 監聽 galleryImages 變化去重設 selectedIndex——重新掛載
  // 順便也會一起重置 lightboxOpen，比原本只重設 selectedIndex 更完整。

  // 這個 effect 是真的需要訂閱外部事件、不是能在算 selectedIndex 時
  // 直接算出來的值：activeVariantId 是「客人在旁邊的 AddToCartButton
  // 點了哪個規格」這個完全獨立的使用者互動觸發的，selectedIndex 同時
  // 也會被這裡的使用者自己手動切圖的操作改動，兩者沒有單純的優先順序
  // 關係可以用一個 render-time 算式表示，用 effect 反而比較清楚。
  useEffect(() => {
    if (!activeVariantId) return;
    const variantImageIndex = galleryImages.findIndex((image) => image.variantId === activeVariantId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (variantImageIndex >= 0) setSelectedIndex(variantImageIndex);
  }, [activeVariantId, galleryImages]);

  function selectImage(index: number) {
    setSelectedIndex((index + galleryImages.length) % galleryImages.length);
  }

  function goToPrevious() {
    if (!galleryImages.length) return;
    selectImage(selectedIndex - 1);
  }

  function goToNext() {
    if (!galleryImages.length) return;
    selectImage(selectedIndex + 1);
  }

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") goToPrevious();
      if (event.key === "ArrowRight") goToNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleTouchEnd(clientX: number) {
    if (touchStartX.current == null || !hasMultipleImages) return;
    const delta = clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    if (delta > 0) goToPrevious();
    else goToNext();
  }

  if (!galleryImages.length) {
    return (
      <div className="mx-auto grid aspect-square h-[280px] place-items-center rounded-3xl border-2 border-dashed border-penguin-peach bg-white/80 text-sm font-bold text-gray-400 sm:h-[360px] lg:h-[480px]">
        圖片準備中
      </div>
    );
  }

  const selectedImage = galleryImages[selectedIndex] || galleryImages[0];
  const largeImage = cloudinaryImageUrl(selectedImage.url, 1200);

  return (
    <div className="space-y-3">
      <div
        className="group relative mx-auto aspect-square h-[280px] overflow-hidden rounded-3xl border-4 border-white bg-white shadow-xl sm:h-[360px] lg:h-[480px]"
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          handleTouchEnd(event.changedTouches[0]?.clientX ?? 0);
        }}
      >
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-zoom-in"
          aria-label="放大商品圖片"
          onClick={() => setLightboxOpen(true)}
        />
        <Image
          src={largeImage}
          alt={selectedImage.altText || productName}
          fill
          priority={selectedIndex === primaryIndex(galleryImages)}
          sizes="(max-width: 1024px) 100vw, 48vw"
          className="object-contain"
        />
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full bg-white/90 p-2 text-penguin-pink-dark shadow-sm">
          <Maximize2 size={16} />
        </div>
        {hasMultipleImages ? (
          <>
            <button
              type="button"
              className="absolute left-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow-sm transition hover:bg-white"
              aria-label="上一張商品圖片"
              onClick={goToPrevious}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="absolute right-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow-sm transition hover:bg-white"
              aria-label="下一張商品圖片"
              onClick={goToNext}
            >
              <ChevronRight size={20} />
            </button>
            <div className="absolute bottom-3 right-3 z-20 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-gray-500 shadow-sm">
              {selectedIndex + 1} / {galleryImages.length}
            </div>
          </>
        ) : null}
      </div>

      {hasMultipleImages ? (
        <div className="nav-scrollbar flex gap-2 overflow-x-auto pb-1">
          {galleryImages.map((image, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={`${image.publicId || image.url}-${index}`}
                type="button"
                className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 bg-white transition sm:h-24 sm:w-24 ${
                  isSelected ? "border-penguin-pink-dark shadow-md shadow-pink-100" : "border-penguin-peach hover:border-penguin-pink"
                }`}
                aria-label={`切換到第 ${index + 1} 張商品圖片`}
                onClick={() => selectImage(index)}
              >
                <Image
                  src={cloudinaryImageUrl(image.url, 220)}
                  alt={image.altText || `${productName} ${index + 1}`}
                  fill
                  sizes="96px"
                  loading="lazy"
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {lightboxOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white text-penguin-pink-dark shadow-lg"
            aria-label="關閉放大檢視"
            onClick={() => setLightboxOpen(false)}
          >
            <X size={22} />
          </button>
          <div
            className="relative h-[82vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              handleTouchEnd(event.changedTouches[0]?.clientX ?? 0);
            }}
          >
            <Image
              src={cloudinaryImageUrl(selectedImage.url, 1600)}
              alt={selectedImage.altText || productName}
              fill
              sizes="100vw"
              className="object-contain"
            />
            {hasMultipleImages ? (
              <>
                <button
                  type="button"
                  className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow"
                  aria-label="放大檢視上一張"
                  onClick={goToPrevious}
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow"
                  aria-label="放大檢視下一張"
                  onClick={goToNext}
                >
                  <ChevronRight size={22} />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-gray-500 shadow">
                  {selectedIndex + 1} / {galleryImages.length}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

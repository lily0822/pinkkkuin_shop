"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

type ProductArtProps = {
  images: string[];
  name: string;
  width?: number;
};

function optimizeCloudinary(image: string, width: number) {
  if (!image.includes("/res.cloudinary.com/") || !image.includes("/upload/")) return image;
  return image.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
}

// 商品卡片的圖片滑動：完全手動，不自動播放。手機原生觸控滑動；桌機
// 滑鼠移到圖片上才出現左右箭頭，平常不佔畫面。整個卡片外層包著
// <Link>，所以滑動手勢要攔截 click 事件，避免滑一下變成誤點進詳情頁；
// 單純點擊（沒有橫向拖曳）則維持原本「點圖片進詳情頁」的行為。
export function ProductArt({ images, name, width = 600 }: ProductArtProps) {
  const gallery = images.filter(Boolean);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const hasMultiple = gallery.length > 1;

  if (!gallery.length) {
    return (
      <div className="grid aspect-square place-items-center rounded-2xl bg-gradient-to-br from-penguin-pink-light to-penguin-yellow text-5xl">
        🐧
      </div>
    );
  }

  function go(delta: number) {
    setIndex((prev) => (prev + delta + gallery.length) % gallery.length);
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    draggedRef.current = false;
  }

  function handleTouchMove(event: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const delta = (event.touches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(delta) > 10) draggedRef.current = true;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current == null || !hasMultiple) return;
    const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    if (delta > 0) go(-1);
    else go(1);
  }

  function handleClickCapture(event: React.MouseEvent) {
    if (draggedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      draggedRef.current = false;
    }
  }

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-penguin-pink-light to-penguin-yellow"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClickCapture={handleClickCapture}
    >
      <Image
        src={optimizeCloudinary(gallery[index], width)}
        alt={name}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        className="object-cover transition duration-300 group-hover:scale-105"
      />
      {hasMultiple ? (
        <>
          <button
            type="button"
            aria-label="上一張圖片"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              go(-1);
            }}
            className="absolute left-1 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow sm:group-hover:grid"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="下一張圖片"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              go(1);
            }}
            className="absolute right-1 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-penguin-pink-dark shadow sm:group-hover:grid"
          >
            <ChevronRight size={14} />
          </button>
          <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-1">
            {gallery.map((image, dotIndex) => (
              <span
                key={`${image}-${dotIndex}`}
                className={`h-1.5 w-1.5 rounded-full transition ${dotIndex === index ? "bg-white" : "bg-white/50"}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

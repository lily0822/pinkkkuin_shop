"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MouseEvent, PointerEvent, TransitionEvent, useEffect, useMemo, useRef, useState } from "react";
import { cloudinaryTransform } from "@/lib/brand-settings";
import type { SiteBanner } from "@/lib/appearance-settings";

type HomeBannerCarouselProps = {
  banners: SiteBanner[];
};

const AUTOPLAY_DELAY = 5000;
const SWIPE_THRESHOLD = 60;

export function HomeBannerCarousel({ banners }: HomeBannerCarouselProps) {
  const activeBanners = useMemo(() => banners.filter((banner) => banner.desktopImageUrl || banner.mobileImageUrl), [banners]);
  const bannerCount = activeBanners.length;
  const hasMultiple = bannerCount > 1;
  const trackBanners = useMemo(() => {
    if (!hasMultiple) return activeBanners;
    return [activeBanners[bannerCount - 1], ...activeBanners, activeBanners[0]];
  }, [activeBanners, bannerCount, hasMultiple]);

  const [trackIndex, setTrackIndex] = useState(hasMultiple ? 1 : 0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [autoplayTick, setAutoplayTick] = useState(0);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const movedDuringDrag = useRef(false);
  const transitionInProgress = useRef(false);
  const resetFrame = useRef<number | null>(null);

  function restartAutoplayTimer() {
    setAutoplayTick((value) => value + 1);
  }

  function nextActiveIndex(currentIndex: number) {
    if (!bannerCount) return 0;
    return (currentIndex + 1) % bannerCount;
  }

  function previousActiveIndex(currentIndex: number) {
    if (!bannerCount) return 0;
    return (currentIndex - 1 + bannerCount) % bannerCount;
  }

  function goNext(manual = false) {
    if (!hasMultiple) return;
    if (transitionInProgress.current) return;
    transitionInProgress.current = true;
    setTransitionEnabled(true);
    setTrackIndex((currentIndex) => currentIndex + 1);
    setActiveIndex((currentIndex) => nextActiveIndex(currentIndex));
    if (manual) restartAutoplayTimer();
  }

  function goPrev(manual = false) {
    if (!hasMultiple) return;
    if (transitionInProgress.current) return;
    transitionInProgress.current = true;
    setTransitionEnabled(true);
    setTrackIndex((currentIndex) => currentIndex - 1);
    setActiveIndex((currentIndex) => previousActiveIndex(currentIndex));
    if (manual) restartAutoplayTimer();
  }

  function goTo(nextIndex: number, manual = false) {
    if (!bannerCount) return;
    const normalizedIndex = (nextIndex + bannerCount) % bannerCount;
    if (normalizedIndex === activeIndex) {
      if (manual) restartAutoplayTimer();
      return;
    }
    if (transitionInProgress.current) return;
    transitionInProgress.current = true;
    setTransitionEnabled(true);
    setActiveIndex(normalizedIndex);
    setTrackIndex(hasMultiple ? normalizedIndex + 1 : normalizedIndex);
    if (manual) restartAutoplayTimer();
  }

  useEffect(() => {
    setTransitionEnabled(false);
    transitionInProgress.current = false;
    setActiveIndex(0);
    setTrackIndex(hasMultiple ? 1 : 0);
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bannerCount, hasMultiple]);

  useEffect(() => {
    if (!hasMultiple) return;
    const timer = window.setInterval(() => goNext(false), AUTOPLAY_DELAY);
    return () => window.clearInterval(timer);
  }, [autoplayTick, hasMultiple, bannerCount]);

  useEffect(() => {
    return () => {
      if (resetFrame.current) window.cancelAnimationFrame(resetFrame.current);
    };
  }, []);

  if (!bannerCount) return null;

  function resetToRealSlide(nextTrackIndex: number) {
    if (resetFrame.current) window.cancelAnimationFrame(resetFrame.current);
    setTransitionEnabled(false);
    setTrackIndex(nextTrackIndex);
    resetFrame.current = window.requestAnimationFrame(() => {
      resetFrame.current = window.requestAnimationFrame(() => {
        transitionInProgress.current = false;
        setTransitionEnabled(true);
        resetFrame.current = null;
      });
    });
  }

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (!hasMultiple) return;
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (trackIndex === 0) {
      resetToRealSlide(bannerCount);
      return;
    }
    if (trackIndex === bannerCount + 1) {
      resetToRealSlide(1);
      return;
    }
    transitionInProgress.current = false;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!hasMultiple) return;
    startX.current = event.clientX;
    isDragging.current = true;
    movedDuringDrag.current = false;
    setTransitionEnabled(false);
    setDragOffset(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDragging.current || startX.current === null) return;
    const nextOffset = event.clientX - startX.current;
    if (Math.abs(nextOffset) > 8) movedDuringDrag.current = true;
    setDragOffset(nextOffset);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    const finalOffset = dragOffset;
    isDragging.current = false;
    startX.current = null;
    setDragOffset(0);
    setTransitionEnabled(true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!transitionInProgress.current && finalOffset > SWIPE_THRESHOLD) goPrev(true);
    else if (!transitionInProgress.current && finalOffset < -SWIPE_THRESHOLD) goNext(true);
    else restartAutoplayTimer();
  }

  function handleBannerClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!movedDuringDrag.current) return;
    event.preventDefault();
    movedDuringDrag.current = false;
  }

  function stopControlPointer(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  function stopControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  const translate = `calc(${-trackIndex * 100}% + ${dragOffset}px)`;

  return (
    <section className="overflow-hidden rounded-3xl border-4 border-penguin-peach-dark bg-white shadow-lg">
      <div
        className="relative aspect-[16/7] min-h-[220px] cursor-grab overflow-hidden active:cursor-grabbing md:min-h-[320px]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onPointerLeave={finishDrag}
      >
        <div
          className="relative z-0 flex h-full"
          onTransitionEnd={handleTransitionEnd}
          style={{
            transform: `translateX(${translate})`,
            transition: transitionEnabled ? "transform 420ms ease" : "none",
          }}
        >
          {trackBanners.map((banner, slideIndex) => {
            const desktopSource = banner.desktopImageUrl || banner.mobileImageUrl || "";
            const desktop = cloudinaryTransform(desktopSource, "f_auto,q_auto,w_1600,c_limit");
            const mobile = cloudinaryTransform(banner.mobileImageUrl || desktopSource, "f_auto,q_auto,w_900,c_limit");
            const image = (
              <picture>
                <source media="(max-width: 767px)" srcSet={mobile} />
                <img src={desktop} alt={banner.name} className="h-full w-full select-none object-cover" draggable={false} />
              </picture>
            );

            return (
              <div key={`${banner.id}-${slideIndex}`} className="h-full flex-[0_0_100%]">
                {banner.href ? (
                  <Link href={banner.href} className="block h-full w-full" onClick={handleBannerClick}>
                    {image}
                  </Link>
                ) : (
                  image
                )}
              </div>
            );
          })}
        </div>

        {hasMultiple ? (
          <>
            <button
              type="button"
              aria-label="上一張 Banner"
              onPointerDown={stopControlPointer}
              onClick={(event) => {
                stopControlClick(event);
                goPrev(true);
              }}
              className="absolute left-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-penguin-pink-dark shadow-md transition hover:bg-white"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              aria-label="下一張 Banner"
              onPointerDown={stopControlPointer}
              onClick={(event) => {
                stopControlClick(event);
                goNext(true);
              }}
              className="absolute right-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-penguin-pink-dark shadow-md transition hover:bg-white"
            >
              <ChevronRight size={22} />
            </button>
          </>
        ) : null}

        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          {activeBanners.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              aria-label={`切換到 Banner ${itemIndex + 1}`}
              onPointerDown={stopControlPointer}
              onClick={(event) => {
                stopControlClick(event);
                goTo(itemIndex, true);
              }}
              className={`h-1.5 w-6 rounded-full shadow-sm transition-colors ${
                itemIndex === activeIndex ? "bg-penguin-pink-dark" : "bg-slate-200/90 hover:bg-white"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

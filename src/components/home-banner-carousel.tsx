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
  const activeBanners = useMemo(() => banners.filter((banner) => banner.enabled && (banner.desktopImageUrl || banner.mobileImageUrl)), [banners]);
  const bannerCount = activeBanners.length;
  const hasMultiple = bannerCount > 1;
  const trackBanners = useMemo(() => {
    if (!hasMultiple) return activeBanners;
    return [...activeBanners.slice(-2), ...activeBanners, ...activeBanners.slice(0, 2)];
  }, [activeBanners, bannerCount, hasMultiple]);

  const [trackIndex, setTrackIndex] = useState(hasMultiple ? 2 : 0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [autoplayTick, setAutoplayTick] = useState(0);
  const [paused, setPaused] = useState(false);
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
    setTrackIndex(hasMultiple ? normalizedIndex + 2 : normalizedIndex);
    if (manual) restartAutoplayTimer();
  }

  useEffect(() => {
    setTransitionEnabled(false);
    transitionInProgress.current = false;
    setActiveIndex(0);
    setTrackIndex(hasMultiple ? 2 : 0);
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bannerCount, hasMultiple]);

  useEffect(() => {
    if (!hasMultiple) return;
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!isDragging.current) goNext(false);
    }, AUTOPLAY_DELAY);
    return () => window.clearInterval(timer);
  }, [autoplayTick, hasMultiple, bannerCount, paused]);

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
    if (trackIndex === 1) {
      resetToRealSlide(bannerCount + 1);
      return;
    }
    if (trackIndex === bannerCount + 2) {
      resetToRealSlide(2);
      return;
    }
    transitionInProgress.current = false;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!hasMultiple || transitionInProgress.current || event.button !== 0) return;
    startX.current = event.clientX;
    isDragging.current = true;
    movedDuringDrag.current = false;
    setTransitionEnabled(false);
    setDragOffset(0);

  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDragging.current || startX.current === null) return;
    const nextOffset = event.clientX - startX.current;
    if (Math.abs(nextOffset) > 8) {
      movedDuringDrag.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragOffset(nextOffset);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    const finalOffset = event.type === "pointercancel" ? 0 : event.clientX - (startX.current ?? event.clientX);
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

  const translate = `calc(${-trackIndex * 100}% - ${trackIndex} * var(--banner-gap) + ${dragOffset}px)`;
  const trackLayout = hasMultiple
    ? "ml-[5%] w-[88%] md:ml-[14%] md:w-[calc(36%-12px)]"
    : "mx-auto w-[88%] md:w-[calc(36%-12px)]";

  return (
    <section aria-label="首頁 Banner" aria-roledescription="輪播" className="overflow-hidden [--banner-gap:16px] md:[--banner-gap:24px]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      <div
        className="relative cursor-grab touch-pan-y active:cursor-grabbing"
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          className={`relative z-0 flex gap-[var(--banner-gap)] ${trackLayout}`}
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
              <picture className="block h-full">
                <source media="(max-width: 767px)" srcSet={mobile} />
                <img src={desktop} alt={banner.name} className="h-full w-full select-none object-cover" draggable={false} />
              </picture>
            );

            return (
              <div key={`${banner.id}-${slideIndex}`} className="relative aspect-square min-w-0 flex-[0_0_100%] overflow-hidden rounded-[26px] bg-penguin-pink-light md:rounded-[28px]">
                {hasMultiple && slideIndex !== trackIndex ? (
                  <button type="button" tabIndex={-1} aria-label={slideIndex < trackIndex ? "上一張 Banner" : "下一張 Banner"} className="absolute inset-0 z-10" onClick={() => { if (!movedDuringDrag.current) { if (slideIndex < trackIndex) goPrev(true); else goNext(true); } movedDuringDrag.current = false; }} />
                ) : null}
                {banner.href ? (
                  <Link href={banner.href} className="block h-full w-full" tabIndex={slideIndex === trackIndex ? 0 : -1} onClick={handleBannerClick}>
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
              className="absolute left-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-penguin-pink-dark border border-penguin-peach transition hover:bg-white"
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
              className="absolute right-3 top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-penguin-pink-dark border border-penguin-peach transition hover:bg-white"
            >
              <ChevronRight size={22} />
            </button>
          </>
        ) : null}

      </div>
        <div className="flex flex-wrap justify-center gap-2 px-4 pt-4">
          {activeBanners.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              aria-label={`切換到 Banner ${itemIndex + 1}`}
              aria-current={itemIndex === activeIndex ? "true" : undefined}
              onPointerDown={stopControlPointer}
              onClick={(event) => {
                stopControlClick(event);
                goTo(itemIndex, true);
              }}
              className={`h-2 w-2 rounded-full transition-colors ${
                itemIndex === activeIndex ? "bg-penguin-pink-dark" : "bg-slate-200/90 hover:bg-white"
              }`}
            />
          ))}
        </div>
    </section>
  );
}

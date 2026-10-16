"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/products";
import type { PreorderCatalogData, PreorderProduct, PreorderSeries } from "@/lib/storefront-preorder";

type SortMode =
  | "newest"
  | "price_asc"
  | "price_desc"
  | "deadline_asc"
  | "deadline_desc"
  | "arrival_asc"
  | "arrival_desc";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "最新上架" },
  { value: "price_asc", label: "價格低到高" },
  { value: "price_desc", label: "價格高到低" },
  { value: "deadline_asc", label: "截止日期由近到久" },
  { value: "deadline_desc", label: "截止日期由久到近" },
  { value: "arrival_asc", label: "到貨日期由近到久" },
  { value: "arrival_desc", label: "到貨日期由久到近" },
];

const SERIES_PAGE_SIZE = 4;
const ALL_IP = "全部";

type Countdown = { text: string; variant: "normal" | "urgent" | "closed" };

// 倒數只在頁面渲染當下算一次（頁面刷新才會重新算），不是即時跳動的
// 倒數——跟後台商品管理的倒數顯示邏輯分開寫，但語意一致。
function getCountdown(deadline: string | null): Countdown | null {
  if (!deadline) return null;
  const diffHours = (new Date(deadline).getTime() - Date.now()) / 3_600_000;
  if (diffHours <= 0) return { text: "已截止", variant: "closed" };
  if (diffHours < 24) return { text: `⏰ 剩${Math.ceil(diffHours)}小時`, variant: "urgent" };
  const days = Math.floor(diffHours / 24);
  const hours = Math.floor(diffHours % 24);
  return { text: `⏰ 剩${days}天${hours ? hours + "時" : ""}`, variant: "normal" };
}

function CountdownBadge({ deadline }: { deadline: string | null }) {
  const countdown = getCountdown(deadline);
  if (!countdown) return null;
  const toneClass =
    countdown.variant === "urgent"
      ? "bg-red-600/90"
      : countdown.variant === "closed"
        ? "bg-slate-400/90"
        : "bg-penguin-gray/85";
  return (
    <span className={`absolute right-2 top-2 z-[1] rounded-full px-2.5 py-1 text-[11px] font-black text-white sm:px-3 sm:text-xs ${toneClass}`}>
      {countdown.text}
    </span>
  );
}

function priceLabel(product: PreorderProduct): string {
  if (!product.priceMin && !product.priceMax) return formatPrice(0);
  if (product.priceMin === product.priceMax) return formatPrice(product.priceMin);
  return `${formatPrice(product.priceMin)} ~ ${formatPrice(product.priceMax)}`;
}

function PillButton({
  label,
  selected,
  onClick,
  minWidth,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  minWidth: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ minWidth }}
      className={`flex h-10 flex-none items-center justify-center whitespace-nowrap rounded-2xl border-2 px-3 text-sm font-black transition ${
        selected
          ? "border-[#ec4899] bg-[#ec4899] text-white"
          : "border-penguin-peach bg-white text-penguin-gray hover:border-penguin-pink-dark"
      }`}
    >
      {label}
    </button>
  );
}

function SeriesTile({
  series,
  selected,
  onSelect,
}: {
  series: PreorderSeries;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className="block w-full min-w-0 text-center">
      <div
        className={`relative rounded-2xl border bg-white p-1 transition sm:p-1.5 ${
          selected ? "border-[#ec4899] shadow-[0_0_0_3px_rgba(255,235,241,1)]" : "border-penguin-peach"
        }`}
      >
        {series.coverImageUrl ? (
          <img src={series.coverImageUrl} alt={series.name} className="aspect-square w-full rounded-xl object-cover" />
        ) : (
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-penguin-pink-light text-3xl">🎁</div>
        )}
        <CountdownBadge deadline={series.deadline} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-bold leading-tight text-penguin-gray">{series.name}</p>
    </button>
  );
}

function ProductTile({ product }: { product: PreorderProduct }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<"idle" | "added" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleAdd() {
    if (product.hasMultipleVariants) {
      router.push(`/products/${product.id}`);
      return;
    }
    setStatus("idle");
    setMessage("");
    try {
      const response = await fetch("/api/member/preorder-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.supabaseId, variantId: product.singleVariantId, quantity }),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 401) {
        setStatus("error");
        setMessage("請先登入會員才能加入預購清單。");
        return;
      }
      if (!response.ok || !result?.ok) throw new Error(result?.error || "加入失敗");
      setStatus("added");
      setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("error");
      setMessage("加入失敗，請稍後再試。");
    }
  }

  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-penguin-peach bg-white p-1 sm:p-1.5">
      <Link href={`/products/${product.id}`} className="relative block">
        {product.image ? (
          <img src={product.image} alt={product.name} className="aspect-square w-full rounded-xl object-cover" />
        ) : (
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-penguin-pink-light text-3xl">🎀</div>
        )}
        <CountdownBadge deadline={product.deadline} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-1 py-2 sm:px-1.5">
        <Link href={`/products/${product.id}`}>
          <h3 className="line-clamp-2 min-h-8 text-xs font-bold leading-4 text-penguin-gray sm:text-sm">{product.name}</h3>
        </Link>
        <p className="text-xs font-black leading-tight text-penguin-pink-dark sm:text-sm">{priceLabel(product)}</p>
        <div className="mt-auto flex items-center gap-1.5">
          <div className="flex h-7 shrink-0 items-center rounded-lg border border-penguin-peach sm:h-8">
            <button
              type="button"
              aria-label="減少數量"
              disabled={quantity <= 1}
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              className="h-full w-6 rounded-l-lg disabled:text-gray-300 sm:w-7"
            >
              −
            </button>
            <output className="min-w-4 text-center text-xs tabular-nums sm:min-w-5">{quantity}</output>
            <button
              type="button"
              aria-label="增加數量"
              onClick={() => setQuantity((value) => value + 1)}
              className="h-full w-6 rounded-r-lg sm:w-7"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={status === "added"}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-[#ec4899] text-xs font-black text-white transition hover:bg-penguin-pink-dark disabled:opacity-80 sm:h-8"
          >
            {status === "added" ? `✓ 已加入 ×${quantity}` : "🛒 加入"}
          </button>
        </div>
        {status === "error" ? <p role="status" className="text-xs text-penguin-pink-dark">{message}</p> : null}
      </div>
    </article>
  );
}

export function PreorderCatalog({ products, series, ips }: PreorderCatalogData) {
  const [topIp, setTopIp] = useState(ALL_IP);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("all");
  const [quickFilterIp, setQuickFilterIp] = useState(ALL_IP);
  const [bannerPage, setBannerPage] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [query, setQuery] = useState("");

  const pillWidth = useMemo(() => {
    const longest = [ALL_IP, ...ips.map((ip) => ip.name)].reduce((max, name) => Math.max(max, name.length), 2);
    return Math.max(72, longest * 15 + 32);
  }, [ips]);

  const visibleSeries = useMemo(
    () => (topIp === ALL_IP ? series : series.filter((item) => item.ipNames.includes(topIp))),
    [series, topIp],
  );

  const totalPages = Math.max(1, Math.ceil(visibleSeries.length / SERIES_PAGE_SIZE));
  const effectivePage = ((bannerPage % totalPages) + totalPages) % totalPages;
  const pageSeries = visibleSeries.slice(effectivePage * SERIES_PAGE_SIZE, effectivePage * SERIES_PAGE_SIZE + SERIES_PAGE_SIZE);

  function selectTopIp(ip: string) {
    setTopIp(ip);
    setBannerPage(0);
    setSelectedSeriesId("all");
    setQuickFilterIp(ALL_IP);
  }

  function selectSeriesTile(seriesId: string) {
    setSelectedSeriesId((current) => (current === seriesId ? "all" : seriesId));
  }

  function selectQuickFilterIp(ip: string) {
    setQuickFilterIp(ip);
    setSelectedSeriesId("all");
  }

  const effectiveIp = topIp !== ALL_IP ? topIp : quickFilterIp;

  const resultProducts = useMemo(() => {
    let scoped: PreorderProduct[];
    if (selectedSeriesId !== "all") {
      scoped = products.filter((product) => product.seriesId === selectedSeriesId);
    } else if (effectiveIp !== ALL_IP) {
      scoped = products.filter((product) => product.ipNames.includes(effectiveIp));
    } else {
      scoped = products;
    }

    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery) {
      scoped = scoped.filter((product) => product.name.toLocaleLowerCase().includes(normalizedQuery));
    }

    const byDate = (value: string | null) => (value ? new Date(value).getTime() : null);
    const sorted = [...scoped].sort((a, b) => {
      if (sortMode === "price_asc") return a.priceMin - b.priceMin;
      if (sortMode === "price_desc") return b.priceMin - a.priceMin;
      if (sortMode === "deadline_asc" || sortMode === "deadline_desc") {
        const aValue = byDate(a.deadline);
        const bValue = byDate(b.deadline);
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;
        return sortMode === "deadline_asc" ? aValue - bValue : bValue - aValue;
      }
      if (sortMode === "arrival_asc" || sortMode === "arrival_desc") {
        const aValue = byDate(a.estimatedArrivalDate);
        const bValue = byDate(b.estimatedArrivalDate);
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;
        return sortMode === "arrival_asc" ? aValue - bValue : bValue - aValue;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return sorted;
  }, [products, selectedSeriesId, effectiveIp, query, sortMode]);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-black text-penguin-gray">系列篩選</p>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            <PillButton label={ALL_IP} selected={topIp === ALL_IP} onClick={() => selectTopIp(ALL_IP)} minWidth={pillWidth} />
            {ips.map((ip) => (
              <PillButton key={ip.name} label={ip.name} selected={topIp === ip.name} onClick={() => selectTopIp(ip.name)} minWidth={pillWidth} />
            ))}
          </div>
          <label className="relative hidden flex-none sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-penguin-pink-dark" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋商品名稱..."
              className="h-10 w-60 rounded-2xl border-2 border-penguin-pink bg-penguin-cream pl-9 pr-3 text-sm font-bold outline-none focus:border-penguin-pink-dark"
            />
          </label>
        </div>
        <label className="relative mt-2 block sm:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-penguin-pink-dark" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋商品名稱..."
            className="h-10 w-full rounded-2xl border-2 border-penguin-pink bg-penguin-cream pl-9 pr-3 text-sm font-bold outline-none focus:border-penguin-pink-dark"
          />
        </label>
      </div>

      {visibleSeries.length ? (
        <>
          <div className="relative">
            {totalPages > 1 ? (
              <button
                type="button"
                aria-label="上一頁"
                onClick={() => setBannerPage((page) => page - 1)}
                className="absolute left-[-14px] top-1/2 z-[2] grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border-2 border-penguin-peach bg-white font-black text-penguin-gray shadow hover:border-penguin-pink-dark hover:text-[#ec4899]"
              >
                ‹
              </button>
            ) : null}
            <div className="grid grid-cols-4 gap-2 overflow-hidden sm:gap-3">
              {pageSeries.map((item) => (
                <SeriesTile key={item.id} series={item} selected={selectedSeriesId === item.id} onSelect={() => selectSeriesTile(item.id)} />
              ))}
            </div>
            {totalPages > 1 ? (
              <button
                type="button"
                aria-label="下一頁"
                onClick={() => setBannerPage((page) => page + 1)}
                className="absolute right-[-14px] top-1/2 z-[2] grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border-2 border-penguin-peach bg-white font-black text-penguin-gray shadow hover:border-penguin-pink-dark hover:text-[#ec4899]"
              >
                ›
              </button>
            ) : null}
          </div>
          {totalPages > 1 ? (
            <div className="flex justify-center gap-1.5">
              {Array.from({ length: totalPages }, (_, pageIndex) => (
                <span
                  key={pageIndex}
                  className={`h-1.5 rounded-full transition-all ${
                    pageIndex === effectivePage ? "w-8 bg-[#ec4899]" : "w-5 bg-penguin-peach"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <hr className="border-t-2 border-penguin-peach" />

      <div>
        {topIp === ALL_IP ? (
          <>
            <p className="mb-2 text-sm font-black text-penguin-gray">全部預購商品篩選</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                <PillButton label={ALL_IP} selected={quickFilterIp === ALL_IP} onClick={() => selectQuickFilterIp(ALL_IP)} minWidth={pillWidth} />
                {ips.map((ip) => (
                  <PillButton key={ip.name} label={ip.name} selected={quickFilterIp === ip.name} onClick={() => selectQuickFilterIp(ip.name)} minWidth={pillWidth} />
                ))}
              </div>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-10 flex-none rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
                aria-label="商品排序"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="flex justify-end">
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="h-10 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品排序"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="inline-block rounded-full bg-white px-4 py-2 text-sm font-black text-penguin-gray shadow-sm">
        共 {resultProducts.length} 件商品
      </p>

      {resultProducts.length ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {resultProducts.map((product) => (
            <ProductTile key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border-2 border-dashed border-penguin-peach bg-white p-10 text-center">
          <p className="text-sm font-black text-penguin-gray">目前沒有符合條件的預購商品</p>
        </div>
      )}
    </div>
  );
}

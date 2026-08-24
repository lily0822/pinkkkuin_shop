"use client";

import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ProductCard } from "@/components/product-card";
import { ProductArt } from "@/components/product-art";
import { useCart } from "@/components/cart-provider";
import { formatPrice, Product, ProductStatus, statusLabels } from "@/lib/products";

type SortMode = "newest" | "price_asc" | "price_desc" | "name_asc" | "name_desc";
type PriceRange = "all" | "0-100" | "101-300" | "301-500" | "501-1000" | "1000";

const defaultStatusOptions: ProductStatus[] = ["in_stock", "preorder", "live_order", "sold_out", "restocking"];

function matchesLegacyPrice(product: Product, range: PriceRange) {
  if (range === "all") return true;
  if (range === "0-100") return product.price <= 100;
  if (range === "101-300") return product.price >= 101 && product.price <= 300;
  if (range === "301-500") return product.price >= 301 && product.price <= 500;
  if (range === "501-1000") return product.price >= 501 && product.price <= 1000;
  return product.price > 1000;
}

type ProductCatalogProps = {
  products: Product[];
  initialStatus?: ProductStatus | "all";
  initialCategory?: string;
  initialQuery?: string;
  denseCategoryLayout?: boolean;
};

type FilterPanelProps = {
  categoryOptions: TagOption[];
  ipOptions: TagOption[];
  selectedCategories: string[];
  selectedIps: string[];
  selectedStatuses: ProductStatus[];
  availableStatuses: ProductStatus[];
  minPrice: number;
  maxPrice: number;
  priceMin: number;
  priceMax: number;
  hasBrandData: boolean;
  onToggleCategory: (value: string) => void;
  onToggleIp: (value: string) => void;
  onToggleStatus: (value: ProductStatus) => void;
  onPriceMinChange: (value: number) => void;
  onPriceMaxChange: (value: number) => void;
  onClear: () => void;
};

type TagOption = {
  name: string;
  color?: string;
};

const MIN_PRICE_GAP = 0;

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeIntegerInput(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function PriceRangeControl({
  minPrice,
  maxPrice,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
}: {
  minPrice: number;
  maxPrice: number;
  priceMin: number;
  priceMax: number;
  onPriceMinChange: (value: number) => void;
  onPriceMaxChange: (value: number) => void;
}) {
  const range = Math.max(1, maxPrice - minPrice);
  const minPercent = ((priceMin - minPrice) / range) * 100;
  const maxPercent = ((priceMax - minPrice) / range) * 100;
  const trackStyle = {
    background: `linear-gradient(to right, #e5e7eb 0%, #e5e7eb ${minPercent}%, #ec4899 ${minPercent}%, #ec4899 ${maxPercent}%, #e5e7eb ${maxPercent}%, #e5e7eb 100%)`,
  };

  return (
    <div className="rounded-2xl bg-penguin-cream/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs font-black text-penguin-gray">
        <span>NT${priceMin.toLocaleString("zh-TW")}</span>
        <span>NT${priceMax.toLocaleString("zh-TW")}</span>
      </div>
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={trackStyle} />
        <input
          type="range"
          min={minPrice}
          max={maxPrice}
          value={priceMin}
          onChange={(event) => onPriceMinChange(Number(event.target.value))}
          className="price-range-input z-[2]"
          aria-label="最低價格"
        />
        <input
          type="range"
          min={minPrice}
          max={maxPrice}
          value={priceMax}
          onChange={(event) => onPriceMaxChange(Number(event.target.value))}
          className="price-range-input z-[3]"
          aria-label="最高價格"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] font-black text-gray-500">
          最低
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={priceMin}
            onChange={(event) => onPriceMinChange(normalizeIntegerInput(event.target.value))}
            className="mt-1 h-9 w-full rounded-xl border border-penguin-peach bg-white px-2 text-xs font-black text-penguin-gray outline-none focus:border-penguin-pink"
          />
        </label>
        <label className="text-[11px] font-black text-gray-500">
          最高
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={priceMax}
            onChange={(event) => onPriceMaxChange(normalizeIntegerInput(event.target.value))}
            className="mt-1 h-9 w-full rounded-xl border border-penguin-peach bg-white px-2 text-xs font-black text-penguin-gray outline-none focus:border-penguin-pink"
          />
        </label>
      </div>
    </div>
  );
}

function optionList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function sortedTagOptionList(products: Product[], type: "ip" | "category", fallbackValues: string[]): TagOption[] {
  const tags = new Map<string, { name: string; sortOrder: number; color?: string }>();
  products.forEach((product) => {
    (product.tags || [])
      .filter((tag) => tag.type === type && tag.enabled)
      .forEach((tag) => {
        const name = tag.name.trim();
        if (!name) return;
        const current = tags.get(name);
        const sortOrder = Number.isFinite(tag.sortOrder) ? tag.sortOrder : 9999;
        if (!current || sortOrder < current.sortOrder) tags.set(name, { name, sortOrder, color: tag.color });
      });
  });

  if (!tags.size) return optionList(fallbackValues).map((name) => ({ name }));

  return Array.from(tags.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hant"))
    .map((tag) => ({ name: tag.name, color: tag.color }));
}

function normalizeTagColor(color?: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? (color as string) : "#ec4899";
}

function CheckboxRow({
  checked,
  label,
  color,
  count,
  onChange,
}: {
  checked: boolean;
  label: string;
  color?: string;
  count?: number;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm font-bold text-penguin-gray transition hover:bg-penguin-pink-light/55">
      <span className="inline-flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 rounded border-penguin-peach accent-penguin-pink-dark"
        />
        {color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeTagColor(color) }} aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </span>
      {typeof count === "number" ? <span className="text-xs text-gray-400">{count}</span> : null}
    </label>
  );
}

function FilterSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-penguin-peach/70 pb-4 last:border-b-0 last:pb-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left text-sm font-black text-penguin-gray"
        onClick={() => setOpen((value) => !value)}
      >
        {title}
        <ChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="mt-3 space-y-1">{children}</div> : null}
    </section>
  );
}

function FilterPanel({
  categoryOptions,
  ipOptions,
  selectedCategories,
  selectedIps,
  selectedStatuses,
  availableStatuses,
  minPrice,
  maxPrice,
  priceMin,
  priceMax,
  hasBrandData,
  onToggleCategory,
  onToggleIp,
  onToggleStatus,
  onPriceMinChange,
  onPriceMaxChange,
  onClear,
}: FilterPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-penguin-gray">篩選商品</h2>
        <button type="button" className="text-xs font-black text-penguin-pink-dark" onClick={onClear}>
          清除全部
        </button>
      </div>

      <FilterSection title="商品類別">
        {categoryOptions.length ? (
          categoryOptions.slice(0, 12).map((category) => (
            <CheckboxRow
              key={category.name}
              label={category.name}
              color={category.color}
              checked={selectedCategories.includes(category.name)}
              onChange={() => onToggleCategory(category.name)}
            />
          ))
        ) : (
          <p className="text-xs font-bold text-gray-400">目前沒有可用分類</p>
        )}
      </FilterSection>

      <FilterSection title="IP">
        {hasBrandData && ipOptions.length ? (
          ipOptions.slice(0, 12).map((ip) => (
            <CheckboxRow
              key={ip.name}
              label={ip.name}
              color={ip.color}
              checked={selectedIps.includes(ip.name)}
              onChange={() => onToggleIp(ip.name)}
            />
          ))
        ) : (
          <p className="rounded-2xl bg-stone-50 px-3 py-2 text-xs font-bold leading-5 text-gray-500">
            目前正式商品還沒有 IP 標籤資料；請先在後台商品標籤管理建立 IP 並指派商品。
          </p>
        )}
      </FilterSection>

      <FilterSection title="價格">
        <PriceRangeControl
          minPrice={minPrice}
          maxPrice={maxPrice}
          priceMin={priceMin}
          priceMax={priceMax}
          onPriceMinChange={onPriceMinChange}
          onPriceMaxChange={onPriceMaxChange}
        />
      </FilterSection>

      <FilterSection title="商品狀態">
        {availableStatuses.map((status) => (
          <CheckboxRow
            key={status}
            label={status === "in_stock" ? "有庫存" : statusLabels[status]}
            checked={selectedStatuses.includes(status)}
            onChange={() => onToggleStatus(status)}
          />
        ))}
      </FilterSection>
    </div>
  );
}

export function ProductCatalog({
  products,
  initialStatus = "all",
  initialCategory = "all",
  initialQuery = "",
  denseCategoryLayout = false,
}: ProductCatalogProps) {
  const [query, setQuery] = useState(initialQuery);
  const defaultStatuses = useMemo<ProductStatus[]>(() => {
    if (initialStatus === "all") return [];
    return [initialStatus];
  }, [initialStatus]);
  const defaultCategories = useMemo(() => (initialCategory === "all" ? [] : [initialCategory]), [initialCategory]);
  const [selectedStatuses, setSelectedStatuses] = useState<ProductStatus[]>(defaultStatuses);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(defaultCategories);
  const [selectedIps, setSelectedIps] = useState<string[]>([]);
  const [legacyPriceRange, setLegacyPriceRange] = useState<PriceRange>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const cart = useCart();

  const scopedProducts = useMemo(() => {
    return products.filter((product) => product.status !== "hidden");
  }, [products]);

  const priceBounds = useMemo(() => {
    const prices = scopedProducts.map((product) => product.price).filter((price) => Number.isFinite(price));
    const min = prices.length ? Math.floor(Math.min(...prices)) : 0;
    const max = prices.length ? Math.ceil(Math.max(...prices)) : 0;
    return { min, max: Math.max(min, max) };
  }, [scopedProducts]);

  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);

  const effectivePriceMin = priceMax === 0 && priceBounds.max > 0 ? priceBounds.min : Math.max(priceBounds.min, Math.min(priceMin, priceBounds.max));
  const effectivePriceMax = priceMax === 0 && priceBounds.max > 0 ? priceBounds.max : Math.max(effectivePriceMin, Math.min(priceMax, priceBounds.max));

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return scopedProducts
      .filter((product) => (selectedStatuses.length ? selectedStatuses.includes(product.status) : true))
      .filter((product) => {
        if (!selectedCategories.length) return true;
        const categoryTags = (product.tags || []).filter((tag) => tag.type === "category").map((tag) => tag.name);
        const values = categoryTags.length ? categoryTags : [product.category];
        return selectedCategories.some((category) => values.includes(category));
      })
      .filter((product) => {
        if (!selectedIps.length) return true;
        const ipTags = (product.tags || []).filter((tag) => tag.type === "ip").map((tag) => tag.name);
        const values = ipTags.length ? ipTags : product.brand ? [product.brand] : [];
        return selectedIps.some((ip) => values.includes(ip));
      })
      .filter((product) => denseCategoryLayout ? product.price >= effectivePriceMin && product.price <= effectivePriceMax : matchesLegacyPrice(product, legacyPriceRange))
      .filter((product) => {
        if (!normalizedQuery) return true;
        const searchable = [
          product.name_zh,
          product.name_jp,
          product.sku,
          product.brand,
          product.category,
          ...(product.tags || []).map((tag) => tag.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sortMode === "price_asc") return a.price - b.price;
        if (sortMode === "price_desc") return b.price - a.price;
        if (sortMode === "name_asc") return a.name_zh.localeCompare(b.name_zh);
        if (sortMode === "name_desc") return b.name_zh.localeCompare(a.name_zh);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [denseCategoryLayout, effectivePriceMax, effectivePriceMin, legacyPriceRange, query, scopedProducts, selectedCategories, selectedIps, selectedStatuses, sortMode]);

  const categoryOptions = useMemo(() => {
    return sortedTagOptionList(scopedProducts, "category", scopedProducts.map((product) => product.category));
  }, [scopedProducts]);

  const ipOptions = useMemo(() => {
    return sortedTagOptionList(scopedProducts, "ip", scopedProducts.map((product) => product.brand || ""));
  }, [scopedProducts]);
  const hasBrandData = ipOptions.length > 0;

  const availableStatuses = useMemo<ProductStatus[]>(() => {
    const statuses = new Set(scopedProducts.map((product) => product.status));
    if (initialStatus === "in_stock") return (["in_stock", "sold_out"] satisfies ProductStatus[]).filter((status) => statuses.has(status));
    if (initialStatus === "preorder") return (["preorder", "sold_out"] satisfies ProductStatus[]).filter((status) => statuses.has(status));
    return defaultStatusOptions.filter((status) => statuses.has(status));
  }, [initialStatus, scopedProducts]);

  function toggleValue<T extends string>(values: T[], value: T) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  function updatePriceMin(value: number) {
    const next = clampInteger(value, priceBounds.min, effectivePriceMax - MIN_PRICE_GAP);
    setPriceMin(next);
    if (!priceMax) setPriceMax(priceBounds.max);
  }

  function updatePriceMax(value: number) {
    const next = clampInteger(value, effectivePriceMin + MIN_PRICE_GAP, priceBounds.max);
    setPriceMax(next);
  }

  function clearFilters() {
    setQuery("");
    setSelectedStatuses(defaultStatuses);
    setSelectedCategories(defaultCategories);
    setSelectedIps([]);
    setLegacyPriceRange("all");
    setPriceMin(priceBounds.min);
    setPriceMax(priceBounds.max);
  }

  const activeFilterTags = [
    ...selectedCategories.map((value) => ({ key: `category:${value}`, label: value, onRemove: () => setSelectedCategories((items) => items.filter((item) => item !== value)) })),
    ...selectedIps.map((value) => ({ key: `ip:${value}`, label: value, onRemove: () => setSelectedIps((items) => items.filter((item) => item !== value)) })),
    ...selectedStatuses
      .filter((value) => !defaultStatuses.includes(value) || selectedStatuses.length !== defaultStatuses.length)
      .map((value) => ({ key: `status:${value}`, label: statusLabels[value], onRemove: () => setSelectedStatuses((items) => items.filter((item) => item !== value)) })),
    ...(effectivePriceMin > priceBounds.min || effectivePriceMax < priceBounds.max
      ? [{ key: "price", label: `NT$${effectivePriceMin.toLocaleString("zh-TW")}-${effectivePriceMax.toLocaleString("zh-TW")}`, onRemove: () => { setPriceMin(priceBounds.min); setPriceMax(priceBounds.max); } }]
      : []),
  ];

  const filterPanel = (
    <FilterPanel
      categoryOptions={categoryOptions}
      ipOptions={ipOptions}
      selectedCategories={selectedCategories}
      selectedIps={selectedIps}
      selectedStatuses={selectedStatuses}
      availableStatuses={availableStatuses}
      minPrice={priceBounds.min}
      maxPrice={priceBounds.max}
      priceMin={effectivePriceMin}
      priceMax={effectivePriceMax}
      hasBrandData={hasBrandData}
      onToggleCategory={(value) => setSelectedCategories((items) => toggleValue(items, value))}
      onToggleIp={(value) => setSelectedIps((items) => toggleValue(items, value))}
      onToggleStatus={(value) => setSelectedStatuses((items) => toggleValue(items, value))}
      onPriceMinChange={updatePriceMin}
      onPriceMaxChange={updatePriceMax}
      onClear={clearFilters}
    />
  );

  if (denseCategoryLayout) {
    return (
      <>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 border-y border-penguin-peach/70 bg-white/90 py-3 md:flex-row md:items-center md:justify-between">
            <label className="relative block md:max-w-md md:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-penguin-pink-dark" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋商品名稱、角色、SKU、品牌..."
                className="h-10 w-full rounded-full border-2 border-penguin-pink bg-penguin-cream pl-10 pr-4 text-sm font-bold outline-none transition focus:border-penguin-pink-dark"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border-2 border-penguin-pink bg-white px-4 text-sm font-black lg:hidden"
                onClick={() => setShowFilters(true)}
              >
                <SlidersHorizontal size={17} />
                篩選
              </button>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-10 rounded-full border-2 border-penguin-peach bg-white px-4 text-sm font-black outline-none focus:border-penguin-pink"
                aria-label="商品排序"
              >
                <option value="newest">最新上架</option>
                <option value="price_asc">價格低到高</option>
                <option value="price_desc">價格高到低</option>
                <option value="name_asc">商品名稱 A-Z</option>
                <option value="name_desc">商品名稱 Z-A</option>
              </select>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto rounded-3xl border border-penguin-peach bg-white/95 p-4 shadow-sm">
                {filterPanel}
              </div>
            </aside>

            <section className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-black text-penguin-gray">共 {filteredProducts.length} 件商品</p>
                {activeFilterTags.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeFilterTags.map((tag) => (
                      <button
                        key={tag.key}
                        type="button"
                        onClick={tag.onRemove}
                        className="rounded-full border border-penguin-pink bg-white px-2.5 py-1 text-xs font-black text-penguin-pink-dark"
                      >
                        {tag.label} ×
                      </button>
                    ))}
                    <button type="button" onClick={clearFilters} className="px-2 py-1 text-xs font-black text-gray-500">
                      清除全部
                    </button>
                  </div>
                ) : null}
              </div>

              {filteredProducts.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {filteredProducts.map((product) => (
                    <ProductCard key={product.id} product={product} onQuickView={setQuickViewProduct} compact />
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border-2 border-dashed border-penguin-peach bg-white p-10 text-center">
                  <p className="text-sm font-black text-penguin-gray">沒有找到符合條件的商品</p>
                  <button type="button" className="mt-3 rounded-full bg-penguin-pink px-4 py-2 text-xs font-black text-penguin-gray" onClick={clearFilters}>
                    清除篩選
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>

        {showFilters ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" className="absolute inset-0 bg-black/45" aria-label="關閉篩選" onClick={() => setShowFilters(false)} />
            <aside className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-black text-penguin-gray">篩選</h2>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark" onClick={() => setShowFilters(false)}>
                  <X size={18} />
                </button>
              </div>
              {filterPanel}
              <div className="sticky bottom-0 mt-5 grid grid-cols-2 gap-2 bg-white pt-3">
                <button type="button" className="rounded-2xl border-2 border-penguin-peach px-4 py-3 text-sm font-black text-penguin-gray" onClick={clearFilters}>
                  清除
                </button>
                <button type="button" className="rounded-2xl bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white" onClick={() => setShowFilters(false)}>
                  查看 {filteredProducts.length} 件商品
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        {quickViewProduct ? (
          <QuickViewModal product={quickViewProduct} onClose={() => setQuickViewProduct(null)} onAddToCart={() => cart.addProduct(quickViewProduct)} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="rounded-3xl border-4 border-penguin-peach bg-white/95 p-4 shadow-lg">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-penguin-pink-dark" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋商品名稱、角色、SKU、品牌或分類"
                className="h-12 w-full rounded-full border-2 border-penguin-pink bg-penguin-cream pl-10 pr-4 text-sm font-bold outline-none transition focus:border-penguin-pink-dark"
              />
            </label>
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border-2 border-penguin-pink bg-white px-4 text-sm font-black lg:hidden"
              onClick={() => setShowFilters((value) => !value)}
            >
              <SlidersHorizontal size={18} />
              篩選
            </button>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="h-12 rounded-full border-2 border-penguin-peach bg-white px-4 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品排序"
            >
              <option value="newest">最新上架</option>
              <option value="price_asc">價格低到高</option>
              <option value="price_desc">價格高到低</option>
              <option value="name_asc">商品名稱 A-Z</option>
              <option value="name_desc">商品名稱 Z-A</option>
            </select>
          </div>

          <div className={`${showFilters ? "grid" : "hidden"} mt-3 gap-3 lg:grid lg:grid-cols-3`}>
            <select
              value={selectedStatuses[0] || "all"}
              onChange={(event) => setSelectedStatuses(event.target.value === "all" ? [] : [event.target.value as ProductStatus])}
              className="h-11 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品狀態"
            >
              {(["all", ...defaultStatusOptions] as Array<ProductStatus | "all">).map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "全部狀態" : statusLabels[option]}
                </option>
              ))}
            </select>
            <select
              value={selectedCategories[0] || "all"}
              onChange={(event) => setSelectedCategories(event.target.value === "all" ? [] : [event.target.value])}
              className="h-11 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品分類"
            >
              <option value="all">全部分類</option>
              {categoryOptions.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={legacyPriceRange}
              onChange={(event) => setLegacyPriceRange(event.target.value as PriceRange)}
              className="h-11 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="價格範圍"
            >
              <option value="all">全部價格</option>
              <option value="0-100">NT$0 - 100</option>
              <option value="101-300">NT$101 - 300</option>
              <option value="301-500">NT$301 - 500</option>
              <option value="501-1000">NT$501 - 1000</option>
              <option value="1000">NT$1000 以上</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="rounded-full bg-white px-4 py-2 text-sm font-black text-penguin-gray shadow-sm">
            共 {filteredProducts.length} 件商品
          </p>
          <button
            type="button"
            className="text-xs font-black text-penguin-pink-dark"
            onClick={() => {
              setQuery("");
              setSelectedStatuses([]);
              setSelectedCategories([]);
              setSelectedIps([]);
              setLegacyPriceRange("all");
              setPriceMin(priceBounds.min);
              setPriceMax(priceBounds.max);
            }}
          >
            清除全部篩選
          </button>
        </div>

        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} onQuickView={setQuickViewProduct} />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-penguin-peach bg-white p-10 text-center">
            <span className="text-5xl">🔎</span>
            <p className="mt-3 text-sm font-black text-penguin-gray">目前沒有符合條件的商品</p>
            <p className="mt-1 text-xs text-gray-400">可以換個關鍵字，或清除篩選再看看。</p>
          </div>
        )}
      </div>

      {quickViewProduct ? (
        <QuickViewModal product={quickViewProduct} onClose={() => setQuickViewProduct(null)} onAddToCart={() => cart.addProduct(quickViewProduct)} />
      ) : null}
    </>
  );
}

function QuickViewModal({ product, onClose, onAddToCart }: { product: Product; onClose: () => void; onAddToCart: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <section className="grid w-full max-w-3xl gap-5 rounded-3xl border-4 border-penguin-pink bg-white p-4 shadow-2xl md:grid-cols-[0.9fr_1fr]" onClick={(event) => event.stopPropagation()}>
        <ProductArt image={product.images[0]} name={product.name_zh} width={900} />
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="rounded-full bg-penguin-yellow px-3 py-1 text-xs font-black text-penguin-gray">
                {statusLabels[product.status]}
              </span>
              <h2 className="mt-3 text-2xl font-black text-penguin-gray">{product.name_zh}</h2>
              {product.name_jp ? <p className="mt-1 text-xs font-bold text-gray-400">{product.name_jp}</p> : null}
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
          <p className="mt-4 text-2xl font-black text-penguin-pink-dark">{formatPrice(product.price)}</p>
          <p className="mt-3 flex-1 text-sm leading-7 text-gray-500">{product.description}</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-2xl bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white"
              onClick={onAddToCart}
            >
              加入購物車
            </button>
            <Link
              href={`/products/${product.id}`}
              className="rounded-2xl border-2 border-penguin-pink px-4 py-3 text-center text-sm font-black text-penguin-pink-dark"
            >
              查看商品詳細
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

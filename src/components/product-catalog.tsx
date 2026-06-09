"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { categories, Product, ProductStatus, statusLabels } from "@/lib/products";

type SortMode = "newest" | "price_asc" | "price_desc" | "name_asc" | "name_desc";
type PriceRange = "all" | "0-100" | "101-300" | "301-500" | "501-1000" | "1000";

const statusOptions: Array<ProductStatus | "all"> = [
  "all",
  "in_stock",
  "preorder",
  "live_order",
  "sold_out",
  "restocking",
];

function matchesPrice(product: Product, range: PriceRange) {
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
};

export function ProductCatalog({
  products,
  initialStatus = "all",
  initialCategory = "all",
}: ProductCatalogProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProductStatus | "all">(initialStatus);
  const [category, setCategory] = useState(initialCategory);
  const [priceRange, setPriceRange] = useState<PriceRange>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return products
      .filter((product) => product.status !== "hidden")
      .filter((product) => (status === "all" ? true : product.status === status))
      .filter((product) => (category === "all" ? true : product.category === category))
      .filter((product) => matchesPrice(product, priceRange))
      .filter((product) => {
        if (!normalizedQuery) return true;
        const searchable = [
          product.name_zh,
          product.name_jp,
          product.sku,
          product.brand,
          product.category,
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
  }, [category, priceRange, products, query, sortMode, status]);

  return (
    <div className="space-y-6">
      <div className="rounded-[8px] border border-border bg-white p-3 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋商品名稱、日文名、SKU、角色或分類"
              className="h-12 w-full rounded-[8px] border border-border bg-white pl-10 pr-4 text-sm outline-none focus:border-brand-pink"
            />
          </label>
          <button
            type="button"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-border px-4 text-sm font-bold lg:hidden"
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={18} />
            篩選
          </button>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="h-12 rounded-[8px] border border-border bg-white px-4 text-sm font-bold outline-none focus:border-brand-pink"
            aria-label="商品排序"
          >
            <option value="newest">最新上架</option>
            <option value="price_asc">價格由低到高</option>
            <option value="price_desc">價格由高到低</option>
            <option value="name_asc">商品名稱 A-Z</option>
            <option value="name_desc">商品名稱 Z-A</option>
          </select>
        </div>

        <div className={`${showFilters ? "grid" : "hidden"} mt-3 gap-3 lg:grid lg:grid-cols-3`}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProductStatus | "all")}
            className="h-11 rounded-[8px] border border-border bg-white px-3 text-sm font-bold outline-none focus:border-brand-pink"
            aria-label="販售狀態"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "全部狀態" : statusLabels[option]}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-11 rounded-[8px] border border-border bg-white px-3 text-sm font-bold outline-none focus:border-brand-pink"
            aria-label="商品分類"
          >
            <option value="all">全部分類</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={priceRange}
            onChange={(event) => setPriceRange(event.target.value as PriceRange)}
            className="h-11 rounded-[8px] border border-border bg-white px-3 text-sm font-bold outline-none focus:border-brand-pink"
            aria-label="價格區間"
          >
            <option value="all">全部價格</option>
            <option value="0-100">NT$0～100</option>
            <option value="101-300">NT$101～300</option>
            <option value="301-500">NT$301～500</option>
            <option value="501-1000">NT$501～1000</option>
            <option value="1000">NT$1000 以上</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-bold text-muted">共 {filteredProducts.length} 件商品</p>
      </div>

      {filteredProducts.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="rounded-[8px] border border-dashed border-border bg-white p-10 text-center">
          <p className="font-black">目前沒有符合條件的商品</p>
          <p className="mt-2 text-sm text-muted">可以換個關鍵字或清除篩選再看看。</p>
        </div>
      )}
    </div>
  );
}

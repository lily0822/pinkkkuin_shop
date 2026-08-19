"use client";

import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { ProductArt } from "@/components/product-art";
import { useCart } from "@/components/cart-provider";
import { formatPrice, Product, ProductStatus, statusLabels } from "@/lib/products";

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
  initialQuery?: string;
};

export function ProductCatalog({
  products,
  initialStatus = "all",
  initialCategory = "all",
  initialQuery = "",
}: ProductCatalogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<ProductStatus | "all">(initialStatus);
  const [category, setCategory] = useState(initialCategory);
  const [priceRange, setPriceRange] = useState<PriceRange>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const cart = useCart();

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

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [products]);

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
              value={status}
              onChange={(event) => setStatus(event.target.value as ProductStatus | "all")}
              className="h-11 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品狀態"
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
              className="h-11 rounded-2xl border-2 border-penguin-peach bg-white px-3 text-sm font-black outline-none focus:border-penguin-pink"
              aria-label="商品分類"
            >
              <option value="all">全部分類</option>
              {categoryOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              value={priceRange}
              onChange={(event) => setPriceRange(event.target.value as PriceRange)}
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
              setStatus("all");
              setCategory("all");
              setPriceRange("all");
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setQuickViewProduct(null)}>
          <section className="grid w-full max-w-3xl gap-5 rounded-3xl border-4 border-penguin-pink bg-white p-4 shadow-2xl md:grid-cols-[0.9fr_1fr]" onClick={(event) => event.stopPropagation()}>
            <ProductArt image={quickViewProduct.images[0]} name={quickViewProduct.name_zh} width={900} />
            <div className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-full bg-penguin-yellow px-3 py-1 text-xs font-black text-penguin-gray">
                    {statusLabels[quickViewProduct.status]}
                  </span>
                  <h2 className="mt-3 text-2xl font-black text-penguin-gray">{quickViewProduct.name_zh}</h2>
                  {quickViewProduct.name_jp ? <p className="mt-1 text-xs font-bold text-gray-400">{quickViewProduct.name_jp}</p> : null}
                </div>
                <button className="grid h-9 w-9 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark" onClick={() => setQuickViewProduct(null)} type="button">
                  <X size={18} />
                </button>
              </div>
              <p className="mt-4 text-2xl font-black text-penguin-pink-dark">{formatPrice(quickViewProduct.price)}</p>
              <p className="mt-3 flex-1 text-sm leading-7 text-gray-500">{quickViewProduct.description}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className="rounded-2xl bg-penguin-pink-dark px-4 py-3 text-sm font-black text-white"
                  onClick={() => cart.addProduct(quickViewProduct)}
                >
                  加入選物箱
                </button>
                <Link
                  href={`/products/${quickViewProduct.id}`}
                  className="rounded-2xl border-2 border-penguin-pink px-4 py-3 text-center text-sm font-black text-penguin-pink-dark"
                >
                  查看商品詳細
                </Link>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { formatPrice, Product, statusLabels, statusStyles } from "@/lib/products";
import { ProductArt } from "@/components/product-art";

type ProductCardProps = {
  product: Product;
};

export function ProductCard({ product }: ProductCardProps) {
  const canOrder = product.status !== "sold_out" && product.status !== "hidden";

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-[8px] border border-border bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-pink-100"
    >
      <ProductArt image={product.images[0]} name={product.name_zh} />
      <div className="space-y-2 px-1 py-3">
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[product.status]}`}>
            {statusLabels[product.status]}
          </span>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
            {product.category}
          </span>
        </div>
        <h3 className="line-clamp-2 min-h-[44px] text-sm font-black leading-6 text-foreground">
          {product.name_zh}
        </h3>
        <div className="flex items-end justify-between gap-2">
          <p className="text-lg font-black text-brand-pink-dark">{formatPrice(product.price)}</p>
          <p className="text-xs font-bold text-muted">{canOrder ? "可詢問" : "暫不可下單"}</p>
        </div>
      </div>
    </Link>
  );
}

"use client";

import { ShoppingBasket } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import type { Product } from "@/lib/products";

type AddToCartButtonProps = {
  product: Product;
};

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { addProduct, openCart } = useCart();
  const disabled = product.status === "sold_out" || product.status === "hidden";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        addProduct(product);
        openCart();
      }}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-penguin-pink-dark px-5 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      <ShoppingBasket size={17} />
      {disabled ? "暫不可購買" : "加入選物箱"}
    </button>
  );
}

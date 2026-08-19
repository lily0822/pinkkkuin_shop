"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { formatPrice, Product, statusLabels } from "@/lib/products";

type CopyProductButtonProps = {
  product: Product;
};

export function CopyProductButton({ product }: CopyProductButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = `小企鵝選物詢問\n商品名稱：${product.name_zh}\n價格：${formatPrice(product.price)}\n商品狀態：${statusLabels[product.status]}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-penguin-gray px-5 text-sm font-black text-white shadow-sm"
    >
      <Copy size={17} />
      {copied ? "已複製" : "複製商品資訊"}
    </button>
  );
}

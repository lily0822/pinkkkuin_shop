"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { Product } from "@/lib/products";

type CopyProductButtonProps = {
  product: Product;
};

export function CopyProductButton({ product }: CopyProductButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    // 客戶端元件：用 window.location.origin 取得目前網域，不要碰
    // getSiteOrigin()（那支讀的是 server 端 env var，瀏覽器端拿不到
    // VERCEL_URL 這類非 NEXT_PUBLIC_ 的變數）；window.location.origin
    // 本來就是瀏覽器當下實際在用的網域，不會寫死、也不用額外設定。
    const url = `${window.location.origin}/products/${product.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-penguin-gray px-5 text-sm font-black text-white shadow-sm"
    >
      <Link2 size={17} />
      {copied ? "已複製連結" : "複製商品連結"}
    </button>
  );
}

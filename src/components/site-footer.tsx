import Link from "next/link";
import { Camera, MessageCircle } from "lucide-react";
import { contactLinks } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-white pb-20 sm:pb-0">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <p className="text-lg font-black">Pinkkkuin / 小企鵝選物</p>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted">
            日本可愛雜貨與角色商品代購，商品狀態與庫存以私訊確認為準。
          </p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          <Link
            href={contactLinks.instagram}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-bold"
          >
            <Camera size={17} />
            Instagram
          </Link>
          <Link
            href={contactLinks.line}
            className="inline-flex items-center gap-2 rounded-full bg-brand-mint px-4 py-2 text-sm font-bold"
          >
            <MessageCircle size={17} />
            LINE 下單
          </Link>
        </div>
      </div>
    </footer>
  );
}

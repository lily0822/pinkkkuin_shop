import Link from "next/link";
import { Camera, MessageCircle } from "lucide-react";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { contactLinks } from "@/lib/site";

export async function SiteFooter() {
  const { siteInfo } = await getAppearanceSettings();
  const instagramUrl = siteInfo.instagramUrl || contactLinks.instagram;
  const lineUrl = siteInfo.lineUrl || contactLinks.line;

  return (
    <footer className="mt-16 border-t-4 border-penguin-pink bg-penguin-pink-light px-4 py-12 pb-24 text-center sm:pb-12">
      <div className="mx-auto max-w-xl space-y-4">
        <h2 className="flex items-center justify-center gap-2 text-lg font-black text-penguin-pink-dark">
          🐧 小企鵝選物 - 日本限定連線代購
        </h2>
        <p className="text-xs leading-7 text-gray-500">
          專門收集日本限定、可愛雜貨、角色周邊與現貨選物。下單前歡迎透過 LINE 或 Instagram 確認庫存與代購細節。
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href={instagramUrl}
            className="inline-flex items-center gap-2 rounded-full border-2 border-penguin-pink bg-white px-4 py-2 text-sm font-bold text-penguin-gray shadow-sm"
          >
            <Camera size={17} />
            Instagram
          </Link>
          <Link
            href={lineUrl}
            className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-4 py-2 text-sm font-bold text-white shadow-sm"
          >
            <MessageCircle size={17} />
            LINE
          </Link>
        </div>
      </div>
    </footer>
  );
}

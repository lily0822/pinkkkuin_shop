import Link from "next/link";
import { Camera, MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { contactLinks } from "@/lib/site";

const orderSteps = ["選擇想購買的商品", "複製商品名稱或截圖", "私訊 IG 或 LINE 官方帳號", "等待確認庫存與金額", "付款完成後安排出貨"];

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="Contact" title="聯絡我們 / 下單方式" description="目前採私訊下單，客服會協助確認庫存、金額與付款方式。" />
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <section className="rounded-[8px] border border-border bg-white p-6">
          <h2 className="font-black">官方帳號</h2>
          <div className="mt-5 grid gap-3">
            <Link href={contactLinks.instagram} className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-pink px-5 py-3 text-sm font-black text-white">
              <Camera size={18} />
              前往 Instagram @pinkkkuin.jp
            </Link>
            <Link href={contactLinks.line} className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-mint px-5 py-3 text-sm font-black">
              <MessageCircle size={18} />
              加入 LINE 官方帳號 @pinkkkuin
            </Link>
          </div>
          <p className="mt-5 text-sm leading-7 text-muted">客服回覆時間會依連線、出貨與活動量調整，急單請先私訊確認。</p>
        </section>

        <section className="rounded-[8px] border border-border bg-white p-6">
          <h2 className="font-black">下單流程</h2>
          <ol className="mt-5 grid gap-3">
            {orderSteps.map((step, index) => (
              <li key={step} className="flex gap-3 rounded-[8px] bg-pink-50 p-3 text-sm font-bold">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs text-brand-pink-dark">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

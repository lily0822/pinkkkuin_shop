import { SectionHeading } from "@/components/section-heading";

const faqs = [
  ["什麼是預購？", "預購是先登記並付款，等日本商品到貨後再安排出貨。"],
  ["預購多久會到？", "通常約 15～30 天，不含官方延期、缺貨或物流延遲。"],
  ["預購可以取消嗎？", "預購商品下單成立後，不接受任意取消。"],
  ["預購商品如果官方缺貨怎麼辦？", "會協助退款或改單，並以私訊通知。"],
  ["現貨多久出貨？", "付款完成後約 2～5 天內安排出貨。"],
  ["可以保留商品嗎？", "可私訊詢問，保留規則會依商品與活動調整。"],
  ["售完會補貨嗎？", "部分商品會補貨，請以公告或私訊回覆為準。"],
  ["可以併單嗎？", "可以先私訊確認，會依商品到貨時間與包材狀況安排。"],
  ["運費怎麼算？", "依出貨方式與活動規則計算，連線活動可能有滿額免運。"],
  ["可以直接在網站付款嗎？", "目前網站是商品型錄，付款需透過 IG 或 LINE 私訊確認。"],
  ["可以用 LINE Pay 嗎？", "可以，實際付款資訊請私訊確認。"],
  ["可以匯款嗎？", "可以，匯款資訊會於確認訂單後提供。"],
];

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="FAQ" title="常見問題" description="整理預購、現貨、出貨與下單相關問題。" />
      <div className="mt-7 grid gap-3">
        {faqs.map(([question, answer]) => (
          <details key={question} className="rounded-[8px] border border-border bg-white p-5">
            <summary className="cursor-pointer font-black">{question}</summary>
            <p className="mt-3 text-sm leading-7 text-muted">{answer}</p>
          </details>
        ))}
      </div>
    </main>
  );
}

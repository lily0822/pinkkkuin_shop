import { CalendarDays } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";

const campaigns = [
  {
    title: "5 月日本連線",
    period: "5/10～5/18",
    deadline: "5/18 23:59",
    arrival: "約 15～30 天",
    discount: "滿 NT$1000 折 NT$50，滿 NT$2000 折 NT$100",
    shipping: "連線商品滿 NT$200 免運",
    notice: "連線商品以現場庫存為準，若官方缺貨會協助退款或改單。",
  },
];

export default function CampaignsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="Campaign" title="連線 / 活動資訊" description="目前連線、預購、滿額折扣與免運資訊都會整理在這裡。" />
      <div className="mt-7 grid gap-4">
        {campaigns.map((campaign) => (
          <article key={campaign.title} className="rounded-[8px] border border-border bg-white p-6">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-1 text-brand-pink-dark" size={22} />
              <div>
                <h2 className="text-xl font-black">{campaign.title}</h2>
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="font-black text-muted">活動期間</dt><dd className="mt-1">{campaign.period}</dd></div>
                  <div><dt className="font-black text-muted">收單截止</dt><dd className="mt-1">{campaign.deadline}</dd></div>
                  <div><dt className="font-black text-muted">預計到貨</dt><dd className="mt-1">{campaign.arrival}</dd></div>
                  <div><dt className="font-black text-muted">滿額活動</dt><dd className="mt-1">{campaign.discount}</dd></div>
                  <div><dt className="font-black text-muted">免運活動</dt><dd className="mt-1">{campaign.shipping}</dd></div>
                  <div><dt className="font-black text-muted">注意事項</dt><dd className="mt-1">{campaign.notice}</dd></div>
                </dl>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

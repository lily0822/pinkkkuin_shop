import { SectionHeading } from "@/components/section-heading";

const guideSections = [
  ["現貨商品", "現貨商品付款完成後，約 2～5 天內安排出貨。"],
  ["預購商品", "預購商品需等待日本商品到貨後再安排出貨，通常約 15～30 天，不含特殊延遲。"],
  ["付款方式", "目前可使用匯款、LINE Pay、賣貨便等方式，實際方式請私訊確認。"],
  ["出貨方式", "可使用 7-11 賣貨便、店到店，其他方式會依商品尺寸與活動調整。"],
  ["取消訂單規則", "預購商品下單成立後，不接受任意取消。"],
  ["瑕疵與退換貨", "日本商品可能存在初始小刮痕、包裝壓痕、外盒運送痕跡等情況，完美主義者請斟酌下單。"],
  ["代購風險", "預購或連線商品可能遇到官方缺貨、延期出貨、限購、砍單等情況，若無法成功購入，會協助退款或改單。"],
];

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="Guide" title="購物須知" description="下單前請先閱讀代購、預購、現貨與退換貨規則。" />
      <div className="mt-7 grid gap-3">
        {guideSections.map(([title, content]) => (
          <section key={title} className="rounded-[8px] border border-border bg-white p-5">
            <h2 className="font-black">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{content}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

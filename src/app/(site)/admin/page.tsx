import { SectionHeading } from "@/components/section-heading";

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Admin"
        title="後台商品管理"
        description="第一版先完成前台商品型錄。後台將於 Phase 2 加入管理員登入、商品新增 / 編輯 / 刪除、圖片管理與公告管理。"
      />
      <div className="mt-7 rounded-[8px] border border-border bg-white p-6">
        <h2 className="font-black">待開發功能</h2>
        <ul className="mt-4 grid gap-2 text-sm leading-7 text-muted">
          <li>商品新增、編輯、刪除</li>
          <li>圖片上傳與排序</li>
          <li>商品狀態、分類與熱門商品設定</li>
          <li>公告與活動管理</li>
        </ul>
      </div>
    </main>
  );
}

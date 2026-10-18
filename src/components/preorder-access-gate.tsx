import Link from "next/link";
import type { PreorderAccess } from "@/lib/member/preorder-access";

// 預購獨立流程 第三期：沒有資格看預購內容時顯示的門禁提示——純伺服器
// component，不吃任何商品資料，只吃 access.isLoggedIn 決定 CTA 指向
// /login 還是 /member/account（已登入但沒綁定 LINE）。
export function PreorderAccessGate({ access, returnTo }: { access: PreorderAccess; returnTo?: string }) {
  const ctaHref = access.isLoggedIn ? "/member/account" : `/login${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`;
  const ctaLabel = access.isLoggedIn ? "前往會員中心綁定 LINE" : "前往登入";

  return (
    <section className="mx-auto w-full max-w-md rounded-[28px] border-2 border-penguin-peach bg-white p-6 text-center shadow-sm sm:p-8">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Pinkkkuin Shop</p>
      <h1 className="mt-2 text-2xl font-black text-penguin-gray">預購內容僅限 LINE 綁定會員</h1>
      <p className="mt-4 text-sm font-bold leading-7 text-gray-500">
        {access.isLoggedIn
          ? "請先到會員中心完成 LINE 綁定，才能查看預購商品。"
          : "請先登入會員並完成 LINE 綁定，才能查看預購商品。"}
      </p>
      <Link
        href={ctaHref}
        className="mt-6 inline-flex items-center justify-center rounded-full bg-penguin-pink-dark px-6 py-3 text-sm font-black text-white shadow-sm"
      >
        {ctaLabel}
      </Link>
    </section>
  );
}

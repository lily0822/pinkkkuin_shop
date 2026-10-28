// 客人專用頁面（/live/*）共用的錯誤畫面——LOGO 已經由 live/layout.tsx
// 顯示在上方，這裡只放提示文字，不放任何連回網站其他頁面的連結（獨立
// 版面不該讓客人發現背後有個網站）。連結過期、場次結束、找不到訂單等
// 情境都共用這支元件，差別只在傳進來的文字。
export function LiveErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <p className="text-base font-black text-penguin-gray">{title}</p>
        <p className="mt-3 text-sm leading-6 text-penguin-gray">{message}</p>
      </div>
    </main>
  );
}

import type { LiveBindingLabel } from "@/lib/line/live-bindings";

// 客人身分列：LOGO 下方、頁面標題上方——LINE 名稱（粗體）+ 一個標籤
// （社群暱稱／IG／尚未綁定，三選一，顏色分別是綠／紫／灰）。純展示用
// 元件，標籤文字過長時用 flex-wrap 換行，不會超出畫面寬度。
export function LiveIdentityRow({ lineName, binding }: { lineName: string; binding: LiveBindingLabel | null }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 px-4 text-center text-[13px]">
      <b className="font-black text-penguin-gray">{lineName}</b>
      {binding?.type === "nickname" ? (
        <span
          className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold"
          style={{ backgroundColor: "#e9f8ef", borderColor: "#8fd3ae", color: "#2f6b48" }}
        >
          社群暱稱　{binding.value}
        </span>
      ) : binding?.type === "ig" ? (
        <span
          className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold"
          style={{ backgroundColor: "#f3e8ff", borderColor: "#d4b4f5", color: "#6b3fa0" }}
        >
          IG　@{binding.value}
        </span>
      ) : (
        <span
          className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold"
          style={{ backgroundColor: "#eef0f4", borderColor: "#d7dbe3", color: "#6b7280" }}
        >
          尚未綁定
        </span>
      )}
    </div>
  );
}

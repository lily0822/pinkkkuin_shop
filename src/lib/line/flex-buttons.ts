// ---------------------------------------------------------------------------
// 卡片按鈕共用元件——原本用 Flex 原生 button 元件（style primary/secondary），
// 顏色是 LINE 內建的綠色/灰色、文字顏色由 LINE 自己決定、無法保證黑色。
// 改成自己組一個可點擊的 box（粉紅底 #ffebf1、粉紅邊 #ff8fb3、圓角膠囊、
// 裡面一個黑字 text）取代，原本的 action（message/postback/uri/clipboard）
// 不變，只是放到 box 的 action 上而不是 button 元件上。抽成這份共用檔案
// 給 livestream-orders.ts 跟 preorder-messaging.ts 都用同一份，不要各自
// 複製貼上。
//
// BUTTON_ICONS 是集中設定表——使用者這輪選的是純文字款（A 款，不加任何
// 圖示），所以每一項都是空字串；之後如果想幫特定按鈕加圖示（例如
// emoji），只需要改這裡對應的值，不用動任何一張卡片的程式碼。key 是
// 按鈕的「語意角色」，不是顯示文字本身——同一顆按鈕换了文案不會讓圖示
// 跟著不見。
// ---------------------------------------------------------------------------

export const BUTTON_ICONS: Record<string, string> = {
  confirm_quantity: "",
  view_orders: "",
  adjust_orders: "",
  remit_live: "",
  remit_preorder: "",
  remit_quickstart: "",
  copy_bank_account: "",
  transfer_done: "",
  amount_correct: "",
  amount_different: "",
  bind: "",
  edit: "",
  preorder_enter: "",
  preorder_open_all: "",
};

export type CuteButtonSpec = { key: string; label: string; action: Record<string, unknown> };

export function buildCuteButton(spec: CuteButtonSpec, flex?: number): object {
  const icon = BUTTON_ICONS[spec.key] || "";
  const text = icon ? `${icon} ${spec.label}` : spec.label;
  const box: Record<string, unknown> = {
    type: "box",
    layout: "horizontal",
    backgroundColor: "#ffebf1",
    borderColor: "#ff8fb3",
    borderWidth: "2px",
    cornerRadius: "xxl",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingStart: "4px",
    paddingEnd: "4px",
    justifyContent: "center",
    alignItems: "center",
    action: spec.action,
    contents: [{ type: "text", text, color: "#111111", weight: "bold", size: "sm", align: "center", wrap: false }],
  };
  if (flex !== undefined) box.flex = flex;
  return box;
}

// 卡片 footer 的共用容器——1 顆按鈕置中滿版；2 顆（含）以上同一行排
// 列、各自 flex:1 平分寬度，超過 2 顆才換行（每行最多 2 顆），符合
// 「多個按鈕排在同一行」的要求。
export function buildCuteButtonFooter(buttons: CuteButtonSpec[]): object {
  if (buttons.length === 1) {
    return { type: "box", layout: "vertical", contents: [buildCuteButton(buttons[0])] };
  }
  const rows: object[] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const rowButtons = buttons.slice(i, i + 2).map((spec) => buildCuteButton(spec, 1));
    rows.push({ type: "box", layout: "horizontal", spacing: "sm", contents: rowButtons });
  }
  return { type: "box", layout: "vertical", spacing: "sm", contents: rows };
}

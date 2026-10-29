// 連線代購下單改版 第三階段：「有效單價」「有效數量」的算法在後台訂單
// 列表、客人 /live/orders、依客人統計、會員中心連線下單紀錄、匯款紀錄、
// 匯款流程本身（src/lib/line/livestream-orders.ts）總共 7 個地方都要用
// 到同一套公式——抽成共用函式，避免各自複製貼上之後算法走樣，造成
// 不同畫面看到的金額互相對不上。

export function effectiveLivestreamUnitPrice(
  sellerUnitPrice: number | null | undefined,
  customerUnitPrice: number | null | undefined,
  legacyUnitPrice: number | null | undefined,
): number | null {
  if (sellerUnitPrice !== null && sellerUnitPrice !== undefined) return Number(sellerUnitPrice);
  if (customerUnitPrice !== null && customerUnitPrice !== undefined) return Number(customerUnitPrice);
  if (legacyUnitPrice !== null && legacyUnitPrice !== undefined) return Number(legacyUnitPrice);
  return null;
}

export function effectiveLivestreamQuantity(
  purchasedQuantity: number | null | undefined,
  orderedQuantity: number | null | undefined,
): number {
  if (purchasedQuantity !== null && purchasedQuantity !== undefined) return Number(purchasedQuantity);
  return Number(orderedQuantity || 1);
}

// 階段二（結算模型）：購買狀態標籤——跟採買/付款是否完成完全無關，純粹
// 描述「賣家幫忙買到了幾個」。抽成共用函式，取代原本在
// src/app/live/orders/page.tsx（computeStatusChip）跟 livestream-orders.ts
// （computeOrderManageStatusChip）各自維護的同一套邏輯——那兩支原本把
// 「已匯款」也塞進同一個標籤裡（蓋掉採買狀態），這輪改成採買狀態跟
// 付款狀態分開顯示兩個標籤，所以這支只管採買狀態，不再過問匯款與否。
export type LivestreamPurchaseChipTone = "pending" | "done" | "out" | "partial";
export type LivestreamPurchaseChip = { label: string; tone: LivestreamPurchaseChipTone };

export function computeLivestreamPurchaseChip(
  purchasedQuantity: number | null | undefined,
  quantity: number,
): LivestreamPurchaseChip {
  if (purchasedQuantity === null || purchasedQuantity === undefined) return { label: "待採買", tone: "pending" };
  const purchased = Number(purchasedQuantity);
  if (purchased === 0) return { label: "缺貨", tone: "out" };
  if (purchased >= quantity) return { label: "已買到", tone: "done" };
  return { label: `買到 ${purchased}・缺 ${quantity - purchased}`, tone: "partial" };
}

// 階段二（結算模型）：以「每個訂單項目」為單位的應付/已付/補款/退款
// 算法，跟使用者規格的定義逐字對應：
//   shouldPay ＝ 應付數量 × 有效單價（有效單價為 null＝「價格未定」，
//     不計算補款或退款，shouldPay 本身回傳 null 讓呼叫端可以跟「真的
//     算出來是 0」區分）
//   owed ＝ max(0, shouldPay − paid)；refundDue ＝ max(0, paid − shouldPay)
// SQL 端（202610290003 migration 的三支 RPC）用同一套公式計算，這支只給
// TS 端（聊天室／網頁／後台 API）顯示用，兩邊故意各自維護一份（跟專案
// 既有「有效單價/有效數量」公式在 SQL／TS／後台 inline JS 三處各自維護
// 一份的慣例一致，不是疏漏）。
export function effectiveLivestreamShouldPay(effectiveUnitPrice: number | null, effectiveQuantity: number): number | null {
  if (effectiveUnitPrice === null) return null;
  return effectiveUnitPrice * effectiveQuantity;
}

export function effectiveLivestreamOwed(shouldPay: number | null, paidAmount: number): number {
  if (shouldPay === null) return 0;
  return Math.max(0, shouldPay - paidAmount);
}

export function effectiveLivestreamRefundDue(shouldPay: number | null, paidAmount: number): number {
  if (shouldPay === null) return 0;
  return Math.max(0, paidAmount - shouldPay);
}

// 付款狀態標籤——階段二審查修正（2026-10-29）：原本 refundedAt 有值時
// 會把 owed/refundDue 直接蓋成 0、強制顯示「已退款」，不管 shouldPay/
// paidAmount 當下算出來是多少。這個蓋寫會把「已退款後賣家又改價/補
// 採買結果，導致又欠錢或又該退更多」的情況藏起來（客人「我要匯款」
// 清單看不到這筆、賣家收不到補款）。修正成：owed/refundDue 永遠先照
// 公式算、不被 refundedAt 覆蓋；refundedAt 只在 owed/refundDue 都已經
// 是 0（真的結清了）時，才用來決定顯示「已退款」還是「已匯款」。
//
// 決策順序（由上往下，符合第一條就停）：
//   1. 缺貨（買到 0 個）、從未付款、也沒被標記退款過 → 不需匯款（這組
//      商品本來就不用付錢；若曾經付過款後來被退款，見第 4 條，不是這條）
//   2. owed>0 且 paid=0 → 未匯款；owed>0 且 paid>0 → 需補款 NT$owed
//      （同一個 owed>0 條件依「這是不是第一次付」分成兩種文案——曾經被
//      標記退款過也不影響這個判斷，欠錢就是欠錢）
//   3. refundDue>0 → 預計退款 NT$refundDue（賣家調低單價/缺貨導致多付，
//      但還沒按「標記已退款」，或是標記退款後價格又調整，又多出新的
//      應退款）
//   4. 其餘（owed=0 且 refundDue=0，真的結清了）：有效單價未定 → 價格
//      未定；已標記退款 → 已退款 NT$refundedAmount；否則 → 已匯款
// group 欄位＝查詢訂單／網頁該分到「還沒匯款」還是「已匯款」：owed>0、
// 「不需匯款」、「價格未定且還沒付款」都在 unpaid 組（見下面各自的
// group 賦值），其餘（含「預計退款」「已退款」「已匯款」）都在 paid 組，
// 這點跟修正前沒有變化，只是計算順序改了。
export type LivestreamPaymentChipTone = "pending" | "paid" | "attention";
export type LivestreamPaymentChip = { label: string; tone: LivestreamPaymentChipTone };
export type LivestreamSettlement = {
  shouldPay: number | null;
  owed: number;
  refundDue: number;
  group: "unpaid" | "paid";
  paymentChip: LivestreamPaymentChip;
};

export function computeLivestreamSettlement(params: {
  effectiveUnitPrice: number | null;
  quantity: number;
  purchasedQuantity: number | null | undefined;
  paidAmount: number;
  refundedAt: string | null | undefined;
  refundedAmount: number | null | undefined;
}): LivestreamSettlement {
  const { effectiveUnitPrice, quantity, purchasedQuantity, paidAmount, refundedAt, refundedAmount } = params;
  const effectiveQuantity = effectiveLivestreamQuantity(purchasedQuantity, quantity);
  const shouldPay = effectiveLivestreamShouldPay(effectiveUnitPrice, effectiveQuantity);
  const owed = effectiveLivestreamOwed(shouldPay, paidAmount);
  const refundDue = effectiveLivestreamRefundDue(shouldPay, paidAmount);

  const purchased = purchasedQuantity === null || purchasedQuantity === undefined ? null : Number(purchasedQuantity);

  // 缺貨且從未付款、也從未被標記退款過——跟「owed/refundDue 剛好都是 0」
  // 的其他情況（例如已結清）語意不同，需要先判斷排除。曾經被標記退款過
  // 的缺貨項目（客人先付款、後來缺貨、賣家標記已退款）要走下面第 4 條
  // 顯示「已退款」，不是這條。
  if (purchased === 0 && paidAmount === 0 && !refundedAt) {
    return { shouldPay, owed, refundDue, group: "unpaid", paymentChip: { label: "不需匯款", tone: "pending" } };
  }

  if (owed > 0) {
    return {
      shouldPay,
      owed,
      refundDue,
      group: "unpaid",
      paymentChip:
        paidAmount === 0 ? { label: "未匯款", tone: "pending" } : { label: `需補款 NT$${Math.round(owed)}`, tone: "attention" },
    };
  }

  if (refundDue > 0) {
    return { shouldPay, owed, refundDue, group: "paid", paymentChip: { label: `預計退款 NT$${Math.round(refundDue)}`, tone: "attention" } };
  }

  // owed === 0 且 refundDue === 0：真的結清了（或價格未定、從未產生欠款）。
  if (effectiveUnitPrice === null) {
    return {
      shouldPay,
      owed,
      refundDue,
      group: paidAmount === 0 ? "unpaid" : "paid",
      paymentChip: { label: "價格未定", tone: "pending" },
    };
  }

  if (refundedAt) {
    return { shouldPay, owed, refundDue, group: "paid", paymentChip: { label: `已退款 NT$${Math.round(refundedAmount || 0)}`, tone: "paid" } };
  }

  return { shouldPay, owed, refundDue, group: "paid", paymentChip: { label: "已匯款", tone: "paid" } };
}

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

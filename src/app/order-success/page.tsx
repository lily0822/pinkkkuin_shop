import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { formatPrice } from "@/lib/products";

export const dynamic = "force-dynamic";

type SuccessOrder = {
  orderNo: string;
  orderType: string;
  total: number;
};

function statusLabel(value?: string) {
  if (value === "pending") return "待處理";
  if (value === "paid") return "已付款";
  if (value === "shipped") return "已出貨";
  if (value === "completed") return "已完成";
  if (value === "cancelled") return "已取消";
  return value || "待處理";
}

function paymentStatusLabel(value?: string) {
  if (value === "pending") return "待付款";
  if (value === "paid") return "已付款";
  if (value === "failed") return "付款失敗";
  if (value === "refunded") return "已退款";
  return value || "待付款";
}

function orderTypeLabel(value?: string) {
  if (value === "stock") return "現貨訂單";
  if (value === "preorder") return "預購訂單";
  return "訂單";
}

function shippingMethodLabel(value?: string) {
  if (value === "home_delivery") return "宅配";
  if (value === "convenience_store") return "超商取貨";
  if (value === "meetup") return "面交";
  return value || "尚未指定";
}

function parseOrders(value?: string, fallbackOrderNo?: string, fallbackTotal = 0): SuccessOrder[] {
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((order) => ({
            orderNo: String(order?.orderNo || "").trim(),
            orderType: String(order?.orderType || "").trim(),
            total: Math.round(Number(order?.total || 0)),
          }))
          .filter((order) => order.orderNo);
      }
    } catch {
      // Fall through to legacy query params.
    }
  }

  if (fallbackOrderNo) {
    return [{ orderNo: fallbackOrderNo, orderType: "", total: fallbackTotal }];
  }

  return [];
}

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    orderNo?: string;
    orderNos?: string;
    orders?: string;
    checkoutGroupId?: string;
    total?: string;
    paymentStatus?: string;
    shippingStatus?: string;
    shippingMethod?: string;
  }>;
}) {
  const params = await searchParams;
  const total = Math.round(Number(params.total || 0));
  const orders = parseOrders(params.orders, params.orderNo || params.orderNos, total);

  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={32} />
        </div>
        <p className="mt-5 text-xs font-black text-penguin-pink-dark">訂單成立</p>
        <h1 className="mt-2 text-3xl font-black text-penguin-gray">訂單已成功送出</h1>
        {orders.length > 1 ? (
          <p className="mx-auto mt-3 max-w-md rounded-full bg-penguin-pink-light px-4 py-2 text-sm font-black text-penguin-pink-dark">
            您的訂單包含現貨與預購商品，已自動拆成 {orders.length} 張訂單。
          </p>
        ) : null}
        <div className="mx-auto mt-6 max-w-md rounded-3xl bg-penguin-cream/80 p-5 text-left">
          <div className="space-y-3 border-b border-penguin-peach pb-3">
            {orders.length ? (
              orders.map((order) => (
                <div key={order.orderNo} className="rounded-2xl bg-white/75 p-3">
                  <div className="flex justify-between gap-4 text-sm font-bold text-gray-500">
                    <span>{orderTypeLabel(order.orderType)}</span>
                    <span className="font-black text-penguin-gray">{order.orderNo}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4 text-sm font-bold text-gray-500">
                    <span>訂單金額</span>
                    <span className="font-black text-penguin-pink-dark">{formatPrice(order.total)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex justify-between gap-4 py-2 text-sm font-bold text-gray-500">
                <span>訂單編號</span>
                <span className="font-black text-penguin-gray">建立中</span>
              </div>
            )}
          </div>
          {params.checkoutGroupId ? (
            <div className="flex justify-between gap-4 border-b border-penguin-peach py-2 text-sm font-bold text-gray-500">
              <span>結帳批次</span>
              <span className="max-w-[180px] truncate font-black text-penguin-gray">{params.checkoutGroupId}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-b border-penguin-peach py-2 text-sm font-bold text-gray-500">
            <span>總金額</span>
            <span className="font-black text-penguin-pink-dark">{formatPrice(total)}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-penguin-peach py-2 text-sm font-bold text-gray-500">
            <span>付款狀態</span>
            <span className="font-black text-penguin-gray">{paymentStatusLabel(params.paymentStatus)}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-penguin-peach py-2 text-sm font-bold text-gray-500">
            <span>配送方式</span>
            <span className="font-black text-penguin-gray">{shippingMethodLabel(params.shippingMethod)}</span>
          </div>
          <div className="flex justify-between gap-4 py-2 text-sm font-bold text-gray-500">
            <span>配送狀態</span>
            <span className="font-black text-penguin-gray">{statusLabel(params.shippingStatus)}</span>
          </div>
        </div>
        <p className="mt-5 text-sm font-bold leading-6 text-gray-500">
          我們已收到你的訂單。正式付款與出貨流程會依商店公告與後續通知處理。
        </p>
        <Link href="/products" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md">
          繼續逛商品
        </Link>
      </section>
    </main>
  );
}

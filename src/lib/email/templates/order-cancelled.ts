import { escapeHtml, formatTaipeiDateTime, formatTwd } from "../utils";
import { EMAIL_BRAND_NAME, renderBaseEmail } from "./base";
import type { EmailOrder } from "../order-notifications";

function orderTypeLabel(value: string): string {
  if (value === "stock") return "現貨";
  if (value === "preorder") return "預購";
  return "訂單";
}

function shippingMethodLabel(value: string): string {
  if (value === "home_delivery") return "宅配";
  if (value === "convenience_store") return "超商取貨";
  if (value === "meetup") return "面交";
  return value || "尚未指定";
}

function renderItems(order: EmailOrder) {
  return order.items
    .map((item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #fce7f3;">
          <div style="font-weight:700;color:#374151;">${escapeHtml(item.productName)}${item.variantSpec ? `（${escapeHtml(item.variantSpec)}）` : ""}</div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#374151;white-space:nowrap;">${escapeHtml(formatTwd(item.unitPrice))}</td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#374151;white-space:nowrap;">${escapeHtml(String(item.quantity))}</td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#831843;font-weight:700;white-space:nowrap;">${escapeHtml(formatTwd(item.subtotal))}</td>
      </tr>`)
    .join("");
}

export function renderOrderCancelledEmail(order: EmailOrder) {
  const orderType = orderTypeLabel(order.orderType);
  const paidNotice =
    order.paymentStatus === "paid"
      ? `<p style="margin:14px 0 0;padding:12px 14px;border-radius:14px;background:#fff7ed;color:#9a3412;font-weight:700;line-height:1.7;">此訂單已付款，取消不代表已自動退款。退款事宜請等待 Pinkkkuin 小企鵝選物與你聯繫。</p>`
      : "";

  const contentHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#374151;">
      ${escapeHtml(order.customerName || "您好")}，你的訂單已取消。
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 16px;">
      <tr>
        <td style="padding:8px 0;color:#9d174d;font-weight:700;white-space:nowrap;width:120px;">訂單編號</td>
        <td style="padding:8px 0;color:#374151;">${escapeHtml(order.orderNo)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#9d174d;font-weight:700;">訂單類型</td>
        <td style="padding:8px 0;color:#374151;">${escapeHtml(orderType)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#9d174d;font-weight:700;">配送方式</td>
        <td style="padding:8px 0;color:#374151;">${escapeHtml(shippingMethodLabel(order.deliveryMethod))}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#9d174d;font-weight:700;">取消時間</td>
        <td style="padding:8px 0;color:#374151;">${escapeHtml(formatTaipeiDateTime(order.cancelledAt || new Date()))}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#9d174d;font-weight:700;">取消原因</td>
        <td style="padding:8px 0;color:#374151;">${escapeHtml(order.cancelReason || "未填寫")}</td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <th align="left" style="padding:8px 0;border-bottom:2px solid #fbcfe8;color:#9d174d;font-size:13px;">商品</th>
        <th align="right" style="padding:8px 0;border-bottom:2px solid #fbcfe8;color:#9d174d;font-size:13px;">單價</th>
        <th align="right" style="padding:8px 0;border-bottom:2px solid #fbcfe8;color:#9d174d;font-size:13px;">數量</th>
        <th align="right" style="padding:8px 0;border-bottom:2px solid #fbcfe8;color:#9d174d;font-size:13px;">小計</th>
      </tr>
      ${renderItems(order)}
    </table>
    <p style="margin:16px 0 0;font-size:16px;line-height:1.8;color:#831843;font-weight:700;">訂單總計：${escapeHtml(formatTwd(order.total))}</p>
    ${paidNotice}
  `;

  return {
    subject: `【${EMAIL_BRAND_NAME}】${orderType}訂單取消 ${order.orderNo}`,
    html: renderBaseEmail({
      title: `${orderType}訂單已取消`,
      preheader: `訂單 ${order.orderNo} 已取消`,
      contentHtml,
    }),
    text: [
      `${orderType}訂單已取消`,
      `訂單編號：${order.orderNo}`,
      `配送方式：${shippingMethodLabel(order.deliveryMethod)}`,
      `取消時間：${formatTaipeiDateTime(order.cancelledAt || new Date())}`,
      `取消原因：${order.cancelReason || "未填寫"}`,
      `訂單總計：${formatTwd(order.total)}`,
      order.paymentStatus === "paid" ? "此訂單已付款，取消不代表已自動退款，退款事宜請等待聯繫。" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

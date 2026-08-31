import { escapeHtml, formatTaipeiDateTime, formatTwd } from "../utils";
import { EMAIL_BRAND_NAME, renderBaseEmail } from "./base";
import type { EmailOrder } from "../order-notifications";

function orderTypeLabel(value: string): string {
  if (value === "stock") return "現貨";
  if (value === "preorder") return "預購";
  return "訂單";
}

function paymentMethodLabel(value: string): string {
  if (value === "bank_transfer" || value === "pending" || !value) return "銀行轉帳";
  return value;
}

function paymentStatusLabel(value: string): string {
  if (value === "pending" || !value) return "待付款";
  if (value === "paid") return "已付款";
  if (value === "failed") return "付款失敗";
  if (value === "refunded") return "已退款";
  return value;
}

function shippingMethodLabel(value: string): string {
  if (value === "home_delivery") return "宅配";
  if (value === "convenience_store") return "超商取貨";
  if (value === "meetup") return "面交";
  return value || "尚未指定";
}

function renderRows(rows: Array<[string, string]>) {
  return rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:#9d174d;font-weight:700;white-space:nowrap;width:120px;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:#374151;">${escapeHtml(value || "—")}</td>
        </tr>`,
    )
    .join("");
}

function renderItems(order: EmailOrder) {
  return order.items
    .map((item) => {
      const spec = item.variantSpec ? `（${escapeHtml(item.variantSpec)}）` : "";
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #fce7f3;">
            <div style="font-weight:700;color:#374151;">${escapeHtml(item.productName)}${spec}</div>
            <div style="font-size:12px;color:#6b7280;">${escapeHtml(orderTypeLabel(item.productType || order.orderType))}</div>
          </td>
          <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#374151;white-space:nowrap;">${escapeHtml(formatTwd(item.unitPrice))}</td>
          <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#374151;white-space:nowrap;">${escapeHtml(String(item.quantity))}</td>
          <td align="right" style="padding:10px 0;border-bottom:1px solid #fce7f3;color:#831843;font-weight:700;white-space:nowrap;">${escapeHtml(formatTwd(item.subtotal))}</td>
        </tr>`;
    })
    .join("");
}

function renderOrderBlock(order: EmailOrder) {
  return `
    <section style="margin:0 0 22px;padding:18px;border:1px solid #fbcfe8;border-radius:16px;background:#fffafd;">
      <h2 style="margin:0 0 12px;font-size:18px;line-height:1.4;color:#831843;">${escapeHtml(orderTypeLabel(order.orderType))}訂單 ${escapeHtml(order.orderNo)}</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:12px;">
        ${renderRows([
          ["成立時間", formatTaipeiDateTime(order.createdAt || new Date())],
          ["配送方式", shippingMethodLabel(order.deliveryMethod)],
          ["付款方式", paymentMethodLabel(order.paymentMethod)],
          ["付款狀態", paymentStatusLabel(order.paymentStatus)],
        ])}
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
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px;">
        ${renderRows([
          ["商品小計", formatTwd(order.subtotal)],
          ["運費", formatTwd(order.shippingFee)],
          ["優惠", formatTwd(order.discountAmount)],
          ["總計", formatTwd(order.total)],
        ])}
      </table>
    </section>`;
}

export function renderOrderCreatedEmail(orders: EmailOrder[]) {
  const firstOrder = orders[0];
  const isMixed = orders.length > 1;
  const recipientRows: Array<[string, string]> = [
    ["顧客姓名", firstOrder?.customerName || ""],
    ["顧客手機", firstOrder?.customerPhone || ""],
    ["Email", firstOrder?.customerEmail || ""],
    ["收件人", firstOrder?.recipientName || ""],
    ["收件手機", firstOrder?.recipientPhone || ""],
  ];
  const firstDeliveryMethod = firstOrder?.deliveryMethod || "";
  const firstDeliveryPlace = firstOrder?.deliveryAddress || firstOrder?.convenienceStoreName || "";
  if (firstDeliveryMethod !== "meetup" && firstDeliveryPlace) {
    recipientRows.push(["地址", firstDeliveryPlace]);
  }
  const title = isMixed ? "你的訂單已成立" : `${orderTypeLabel(firstOrder?.orderType || "")}訂單已成立`;
  const subject = isMixed
    ? `【${EMAIL_BRAND_NAME}】訂單成立 ${orders.map((order) => order.orderNo).join(" / ")}`
    : `【${EMAIL_BRAND_NAME}】${orderTypeLabel(firstOrder?.orderType || "")}訂單成立 ${firstOrder?.orderNo || ""}`;

  const contentHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#374151;">
      ${escapeHtml(firstOrder?.customerName || "您好")}，謝謝你的訂購，我們已收到以下訂單。
    </p>
    ${
      isMixed
        ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:14px;background:#fdf2f8;color:#9d174d;font-weight:700;">你的訂單包含現貨與預購商品，已自動拆成 ${orders.length} 張訂單。</p>`
        : ""
    }
    ${orders.map(renderOrderBlock).join("")}
    <section style="margin-top:4px;padding-top:14px;border-top:1px dashed #f9a8d4;">
      <h2 style="margin:0 0 10px;font-size:16px;color:#831843;">顧客與收件資料</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        ${renderRows(recipientRows)}
      </table>
    </section>
  `;

  return {
    subject,
    html: renderBaseEmail({
      title,
      preheader: `訂單 ${orders.map((order) => order.orderNo).join(" / ")} 已成立`,
      contentHtml,
    }),
    text: [
      title,
      isMixed ? `你的訂單已自動拆成 ${orders.length} 張訂單。` : "",
      ...orders.map(
        (order) =>
          `${orderTypeLabel(order.orderType)}訂單 ${order.orderNo}\n總計：${formatTwd(order.total)}\n${order.items
            .map((item) => `${item.productName}${item.variantSpec ? `（${item.variantSpec}）` : ""} ${formatTwd(item.unitPrice)} x ${item.quantity}`)
            .join("\n")}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

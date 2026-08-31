import { escapeHtml, formatTaipeiDateTime, formatTwd } from "../utils";
import { EMAIL_BRAND_NAME, renderBaseEmail } from "./base";

type TestEmailOptions = {
  environment: string;
  now?: Date;
};

export function renderTestEmail({ environment, now = new Date() }: TestEmailOptions) {
  const title = "Email 系統測試成功";
  const contentHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#374151;">
      如果你收到這封信，代表 staging email provider、寄件人與收件人設定都可以正常運作。
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #fce7f3;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:12px 14px;background:#fff7fb;color:#9d174d;font-weight:700;width:36%;">環境</td>
        <td style="padding:12px 14px;color:#374151;">${escapeHtml(environment)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;background:#fff7fb;color:#9d174d;font-weight:700;">測試時間</td>
        <td style="padding:12px 14px;color:#374151;">${escapeHtml(formatTaipeiDateTime(now))}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;background:#fff7fb;color:#9d174d;font-weight:700;">金額格式</td>
        <td style="padding:12px 14px;color:#374151;">${escapeHtml(formatTwd(1280))}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;background:#fff7fb;color:#9d174d;font-weight:700;">HTML escape</td>
        <td style="padding:12px 14px;color:#374151;">${escapeHtml("Tom & Jerry <Test>")}</td>
      </tr>
    </table>
    <p style="margin:16px 0 0;font-size:14px;line-height:1.8;color:#6b7280;">
      目前這只是一封 staging 測試信，尚未串接訂單成立或取消通知。
    </p>
  `;

  return {
    subject: `【${EMAIL_BRAND_NAME}】Email 測試成功`,
    html: renderBaseEmail({
      title,
      preheader: "Staging email 設定測試",
      contentHtml,
    }),
    text: [
      title,
      `環境：${environment}`,
      `測試時間：${formatTaipeiDateTime(now)}`,
      `金額格式：${formatTwd(1280)}`,
      "HTML escape：Tom & Jerry <Test>",
      "目前這只是一封 staging 測試信，尚未串接訂單成立或取消通知。",
    ].join("\n"),
  };
}

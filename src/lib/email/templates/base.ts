import { escapeHtml } from "../utils";

export const EMAIL_BRAND_NAME = "Pinkkkuin 小企鵝選物";

type BaseEmailOptions = {
  title: string;
  preheader?: string;
  contentHtml: string;
};

export function renderBaseEmail({ title, preheader, contentHtml }: BaseEmailOptions): string {
  const safeTitle = escapeHtml(title);
  const safePreheader = preheader ? escapeHtml(preheader) : "";

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#fff7fb;color:#374151;font-family:Arial,'Noto Sans TC','Microsoft JhengHei',sans-serif;">
    ${safePreheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#fff7fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #fbcfe8;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#fdf2f8;border-bottom:1px solid #fbcfe8;">
                <div style="font-size:13px;letter-spacing:.04em;color:#db2777;font-weight:700;">${escapeHtml(EMAIL_BRAND_NAME)}</div>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.35;color:#831843;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#fff7fb;border-top:1px solid #fce7f3;color:#6b7280;font-size:12px;line-height:1.7;">
                這封信由 ${escapeHtml(EMAIL_BRAND_NAME)} 系統寄出。若你不確定這封信的來源，請直接忽略。
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

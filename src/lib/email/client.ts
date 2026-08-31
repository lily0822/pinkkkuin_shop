import "server-only";

import { renderTestEmail } from "./templates/test-email";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export type EmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type EmailSendResult = {
  provider: "resend";
  id: string | null;
  subject: string;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function isStagingEmailRuntime(): boolean {
  return [env("APP_ENV"), env("SUPABASE_ENV")].some((value) => value.toLowerCase() === "staging");
}

function getEmailConfig() {
  return {
    apiKey: env("RESEND_API_KEY"),
    from: env("EMAIL_FROM"),
    replyTo: env("EMAIL_REPLY_TO"),
    testRecipient: env("EMAIL_TEST_RECIPIENT"),
  };
}

function normalizeRecipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map((item) => item.trim()).filter(Boolean);
}

function stagingSubject(subject: string): string {
  return subject.startsWith("[STAGING]") ? subject : `[STAGING] ${subject}`;
}

function logEmailFailure(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "resend",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

export async function sendEmail({ to, subject, html, text, replyTo }: EmailPayload): Promise<EmailSendResult> {
  const config = getEmailConfig();
  const isStaging = isStagingEmailRuntime();
  const recipients = isStaging ? normalizeRecipients(config.testRecipient) : normalizeRecipients(to);
  const finalSubject = isStaging ? stagingSubject(subject) : subject;
  const finalReplyTo = replyTo?.trim() || config.replyTo || undefined;

  if (!config.apiKey || !config.from || recipients.length === 0) {
    logEmailFailure("email_config_missing", {
      hasApiKey: Boolean(config.apiKey),
      hasFrom: Boolean(config.from),
      hasRecipient: recipients.length > 0,
      environment: isStaging ? "staging" : "production",
    });
    throw new Error("Email 寄送失敗");
  }

  const body: Record<string, unknown> = {
    from: config.from,
    to: recipients,
    subject: finalSubject,
    html,
  };
  if (text) body.text = text;
  if (finalReplyTo) body.reply_to = finalReplyTo;

  let response: Response;
  try {
    response = await fetch(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "pinkkkuin-shop/1.0",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logEmailFailure("email_network_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new Error("Email 寄送失敗");
  }

  const rawText = await response.text();
  let result: unknown = null;
  try {
    result = rawText ? JSON.parse(rawText) : null;
  } catch {
    result = rawText;
  }

  if (!response.ok) {
    logEmailFailure("email_provider_error", {
      status: response.status,
      message:
        result && typeof result === "object" && "message" in result
          ? String((result as { message?: unknown }).message || "")
          : "provider rejected request",
    });
    throw new Error("Email 寄送失敗");
  }

  const id =
    result && typeof result === "object" && "id" in result ? String((result as { id?: unknown }).id || "") : "";

  return {
    provider: "resend",
    id: id || null,
    subject: finalSubject,
  };
}

export async function sendTestEmail(): Promise<EmailSendResult> {
  const environment = isStagingEmailRuntime() ? "staging" : "production";
  const email = renderTestEmail({ environment });
  return sendEmail({
    to: "ignored-by-staging@example.com",
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}

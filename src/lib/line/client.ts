import "server-only";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export type LinePushResult = {
  provider: "line";
  id: string | null;
  disabled?: boolean;
};

type LineTextMessage = {
  type: "text";
  text: string;
};

type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

type LineAdminMessage = LineTextMessage | LineFlexMessage;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function getLineConfig() {
  return {
    channelAccessToken: env("LINE_CHANNEL_ACCESS_TOKEN"),
    adminUserId: env("LINE_ADMIN_USER_ID"),
  };
}

function logLineEvent(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "line",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

export function isLineAdminPushConfigured() {
  const config = getLineConfig();
  return Boolean(config.channelAccessToken && config.adminUserId);
}

function truncateLineText(value: string) {
  const text = value.trim();
  return text.length > 4900 ? `${text.slice(0, 4890)}...` : text;
}

function truncateLineAltText(value: string) {
  const text = value.trim();
  return text.length > 390 ? `${text.slice(0, 387)}...` : text;
}

async function sendLineAdminMessage(message: LineAdminMessage): Promise<LinePushResult> {
  const config = getLineConfig();
  if (!config.channelAccessToken || !config.adminUserId) {
    logLineEvent("line_admin_push_disabled", {
      hasChannelAccessToken: Boolean(config.channelAccessToken),
      hasAdminUserId: Boolean(config.adminUserId),
    });
    return {
      provider: "line",
      id: null,
      disabled: true,
    };
  }

  let response: Response;
  try {
    response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.channelAccessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "pinkkkuin-shop/1.0",
      },
      body: JSON.stringify({
        to: config.adminUserId,
        messages: [message],
      }),
    });
  } catch (error) {
    logLineEvent("line_admin_push_network_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new Error("LINE 管理員通知傳送失敗");
  }

  if (!response.ok) {
    let providerMessage = "provider rejected request";
    try {
      const body = (await response.json()) as { message?: unknown };
      providerMessage = String(body.message || providerMessage);
    } catch {
      providerMessage = response.statusText || providerMessage;
    }
    logLineEvent("line_admin_push_provider_error", {
      status: response.status,
      message: providerMessage,
    });
    throw new Error("LINE 管理員通知傳送失敗");
  }

  return {
    provider: "line",
    id: response.headers.get("x-line-request-id"),
  };
}

export async function sendLineAdminText(text: string): Promise<LinePushResult> {
  return sendLineAdminMessage({
    type: "text",
    text: truncateLineText(text),
  });
}

export async function sendLineAdminFlex(
  altText: string,
  contents: Record<string, unknown>,
): Promise<LinePushResult> {
  return sendLineAdminMessage({
    type: "flex",
    altText: truncateLineAltText(altText),
    contents,
  });
}

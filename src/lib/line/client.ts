import "server-only";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/bot/profile";
const LINE_CONTENT_ENDPOINT = "https://api-data.line.me/v2/bot/message";

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
type LinePushMessage = LineAdminMessage;

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

async function sendLineMessageToUser(
  recipientUserId: string,
  message: LinePushMessage,
  logPrefix: string,
): Promise<LinePushResult> {
  const config = getLineConfig();
  const recipient = recipientUserId.trim();
  if (!config.channelAccessToken || !recipient) {
    logLineEvent(`${logPrefix}_disabled`, {
      hasChannelAccessToken: Boolean(config.channelAccessToken),
      hasRecipient: Boolean(recipient),
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
        to: recipient,
        messages: [message],
      }),
    });
  } catch (error) {
    logLineEvent(`${logPrefix}_network_error`, {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new Error("LINE 通知傳送失敗");
  }

  if (!response.ok) {
    let providerMessage = "provider rejected request";
    try {
      const body = (await response.json()) as { message?: unknown };
      providerMessage = String(body.message || providerMessage);
    } catch {
      providerMessage = response.statusText || providerMessage;
    }
    logLineEvent(`${logPrefix}_provider_error`, {
      status: response.status,
      message: providerMessage,
    });
    throw new Error("LINE 通知傳送失敗");
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

export async function sendLineUserText(recipientUserId: string, text: string): Promise<LinePushResult> {
  return sendLineMessageToUser(
    recipientUserId,
    {
      type: "text",
      text: truncateLineText(text),
    },
    "line_member_push",
  );
}

export async function sendLineUserFlex(
  recipientUserId: string,
  altText: string,
  contents: Record<string, unknown>,
): Promise<LinePushResult> {
  return sendLineMessageToUser(
    recipientUserId,
    {
      type: "flex",
      altText: truncateLineAltText(altText),
      contents,
    },
    "line_member_push",
  );
}

/**
 * Replies to an incoming webhook event using its replyToken. Unlike push
 * (sendLineUserText/sendLineUserFlex above), a reply does NOT count against
 * the LINE Official Account's monthly free/paid push-message quota — every
 * response to a customer's own message or button tap in the 社群連線訂單
 * bot flow (binding, image-order chat, quantity buttons) MUST go through
 * this function, never sendLineUserText/sendLineUserFlex. The one exception
 * in that feature is the "訂單已確認" notification the backend fires on its
 * own initiative (not in response to an incoming message) — that one has no
 * replyToken to use and is a deliberate push (see AI_HANDOFF.md).
 *
 * Never throws: a webhook handler should always resolve normally so LINE
 * doesn't retry the whole delivery — failures are logged and reported back
 * via LinePushResult.disabled instead.
 */
export async function sendLineReply(
  replyToken: string,
  messages: LinePushMessage[],
): Promise<LinePushResult> {
  const config = getLineConfig();
  const token = replyToken.trim();
  if (!config.channelAccessToken || !token || !messages.length) {
    logLineEvent("line_reply_disabled", {
      hasChannelAccessToken: Boolean(config.channelAccessToken),
      hasReplyToken: Boolean(token),
      messageCount: messages.length,
    });
    return { provider: "line", id: null, disabled: true };
  }

  let response: Response;
  try {
    response = await fetch(LINE_REPLY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.channelAccessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "pinkkkuin-shop/1.0",
      },
      // LINE allows at most 5 messages per reply call.
      body: JSON.stringify({ replyToken: token, messages: messages.slice(0, 5) }),
    });
  } catch (error) {
    logLineEvent("line_reply_network_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { provider: "line", id: null, disabled: true };
  }

  if (!response.ok) {
    let providerMessage = "provider rejected request";
    try {
      const body = (await response.json()) as { message?: unknown };
      providerMessage = String(body.message || providerMessage);
    } catch {
      providerMessage = response.statusText || providerMessage;
    }
    logLineEvent("line_reply_provider_error", {
      status: response.status,
      message: providerMessage,
    });
    return { provider: "line", id: null, disabled: true };
  }

  return { provider: "line", id: response.headers.get("x-line-request-id") };
}

export async function sendLineReplyText(replyToken: string, text: string): Promise<LinePushResult> {
  return sendLineReply(replyToken, [{ type: "text", text: truncateLineText(text) }]);
}

export async function sendLineReplyFlex(
  replyToken: string,
  altText: string,
  contents: Record<string, unknown>,
): Promise<LinePushResult> {
  return sendLineReply(replyToken, [{ type: "flex", altText: truncateLineAltText(altText), contents }]);
}

export type LineReplyMessage = LinePushMessage;

export async function getLineUserProfile(userId: string): Promise<{ displayName: string } | null> {
  const config = getLineConfig();
  const id = userId.trim();
  if (!config.channelAccessToken || !id) return null;
  try {
    const response = await fetch(`${LINE_PROFILE_ENDPOINT}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${config.channelAccessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { displayName?: unknown };
    return { displayName: typeof data.displayName === "string" && data.displayName.trim() ? data.displayName.trim() : "LINE 使用者" };
  } catch (error) {
    logLineEvent("line_profile_fetch_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function downloadLineMessageContent(
  messageId: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getLineConfig();
  const id = messageId.trim();
  if (!config.channelAccessToken || !id) return null;
  try {
    const response = await fetch(`${LINE_CONTENT_ENDPOINT}/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${config.channelAccessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (error) {
    logLineEvent("line_content_download_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

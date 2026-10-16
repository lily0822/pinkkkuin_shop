import { NextRequest, NextResponse } from "next/server";
import { isLineWebhookConfigured, verifyLineWebhookSignature } from "@/lib/line/webhook-security";
import { handleLineEvent, type LineWebhookEvent } from "@/lib/line/livestream-orders";
import { handlePreorderLineEvent } from "@/lib/line/preorder-messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LINE Messaging API webhook — receives every message/postback sent to the
 * Official Account. Two independent features share this one webhook/one OA:
 * 社群連線訂單 image ordering (src/lib/line/livestream-orders.ts) and the
 * 預購獨立流程 LINE binding/catalog flow (src/lib/line/preorder-messaging.ts).
 * handlePreorderLineEvent runs first and only "claims" an event when it
 * matches a highly-specific preorder trigger format — everything else falls
 * through unchanged to the pre-existing handleLineEvent.
 * Must be registered as the webhook URL in the LINE Developers console
 * (manual, one-time setup — see AI_HANDOFF.md), with LINE_CHANNEL_SECRET set
 * on Vercel so the signature check below can run.
 */
export async function POST(request: NextRequest) {
  if (!isLineWebhookConfigured()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!verifyLineWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let events: LineWebhookEvent[] = [];
  try {
    const parsed = JSON.parse(rawBody || "{}") as { events?: LineWebhookEvent[] };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    // Malformed body — still acknowledge with 200 so LINE doesn't retry.
    return NextResponse.json({ ok: true });
  }

  // Always resolve with 200 quickly — LINE retries aggressively on
  // non-2xx/timeouts. Each event is handled independently; a failure in one
  // is only logged, never allowed to fail the whole webhook delivery.
  //
  // 預購獨立流程（第二期）先試 handlePreorderLineEvent()：回 true 代表
  // 這則訊息是精確符合預購觸發格式、已經處理完畢，不會再交給下面既有的
  // handleLineEvent（社群連線訂單功能）；回 false 代表跟預購無關，原封
  // 不動交給既有邏輯，對非預購訊息零影響。
  await Promise.all(
    events.map((event) =>
      handlePreorderLineEvent(event)
        .then((handled) => {
          if (!handled) return handleLineEvent(event);
        })
        .catch((error) => {
          console.warn(
            JSON.stringify({
              event: "line_webhook_handler_error",
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
        }),
    ),
  );

  return NextResponse.json({ ok: true });
}

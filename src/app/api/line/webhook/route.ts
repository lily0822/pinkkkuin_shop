import { NextRequest, NextResponse } from "next/server";
import { isLineWebhookConfigured, verifyLineWebhookSignature } from "@/lib/line/webhook-security";
import { handleLineEvent, type LineWebhookEvent } from "@/lib/line/livestream-orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LINE Messaging API webhook — receives every message/postback sent to the
 * Official Account (自助綁定 + 社群連線訂單 image ordering, see
 * src/lib/line/livestream-orders.ts for the actual conversation logic).
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
  await Promise.all(
    events.map((event) =>
      handleLineEvent(event).catch((error) => {
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

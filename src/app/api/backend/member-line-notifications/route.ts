import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS,
  getMemberLineNotificationSettings,
  saveMemberLineNotificationSettings,
  type MemberLineNotificationEvent,
} from "@/lib/line/member-notifications";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENTS: MemberLineNotificationEvent[] = [
  "order_created",
  "order_cancelled",
  "payment_completed",
  "order_shipped",
];

async function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("後台授權失敗。", 403);
  return null;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  try {
    const settings = await getMemberLineNotificationSettings();
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json(
      { ok: false, error: "會員 LINE 通知設定讀取失敗。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  let body: { settings?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供有效的設定內容。" }, { status: 400 });
  }

  const input = body.settings && typeof body.settings === "object" ? body.settings : {};
  const settings = { ...DEFAULT_MEMBER_LINE_NOTIFICATION_SETTINGS };
  for (const event of EVENTS) {
    settings[event] = normalizeBoolean(input[event], settings[event]);
  }

  try {
    const saved = await saveMemberLineNotificationSettings(settings);
    return NextResponse.json({ ok: true, settings: saved });
  } catch {
    return NextResponse.json(
      { ok: false, error: "會員 LINE 通知設定儲存失敗。" },
      { status: 500 },
    );
  }
}

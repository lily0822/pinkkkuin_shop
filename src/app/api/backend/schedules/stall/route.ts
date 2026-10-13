import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import {
  listBackendStallSchedules,
  saveBackendStallSchedule,
  type BackendStallSchedulePayload,
} from "@/lib/backend/schedule-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (!isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_schedules_stall_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const schedules = await listBackendStallSchedules();
    return NextResponse.json({ ok: true, schedules });
  } catch (error) {
    console.error("listBackendStallSchedules failed:", error);
    return NextResponse.json({ ok: false, error: "擺攤時程讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_schedules_stall_save", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: BackendStallSchedulePayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的時程資料。" }, { status: 400 });
  }

  if (!payload?.period) {
    return NextResponse.json({ ok: false, error: "請填寫市集名稱。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendStallSchedule(payload);
    return NextResponse.json({ ok: true, schedule: saved });
  } catch (error) {
    console.error("saveBackendStallSchedule failed:", error);
    return NextResponse.json({ ok: false, error: "擺攤時程儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

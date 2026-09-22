import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (getBackendRuntime() === "unknown") return new NextResponse("Not found", { status: 404 });
  if (shouldRequireBackendAuth() && !(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (shouldRequireBackendAuth() && !isSameOriginMutation(request)) {
    return backendAuthJsonError("請從後台頁面操作。", 403);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const startTime = typeof body?.startTime === "string" ? body.startTime.trim() : "";
  const endTime = typeof body?.endTime === "string" ? body.endTime.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim().slice(0, 200) : "";
  if (
    !id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(startTime) ||
    !/^\d{2}:\d{2}$/.test(endTime) ||
    !location ||
    endTime <= startTime ||
    typeof body?.isOpen !== "boolean"
  ) {
    return NextResponse.json({ ok: false, error: "請確認日期、時間與地點。" }, { status: 400 });
  }

  const { error } = await createSupabaseServiceClient()
    .from("community_meetup_slots")
    .update({ meetup_date: date, start_time: startTime, end_time: endTime, location, is_open: body.isOpen })
    .eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: "面交時段更新失敗。" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

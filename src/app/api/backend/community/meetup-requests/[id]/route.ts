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

const STATUSES = new Set(["pending", "confirmed", "completed", "cancelled"]);

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
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = typeof body?.status === "string" ? body.status.trim() : "";
  if (!id || !STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: "請選擇有效的面交狀態。" }, { status: 400 });
  }

  const { data, error } = await createSupabaseServiceClient().rpc(
    "backend_update_community_meetup_request",
    { p_id: id, p_status: status },
  );
  if (error) {
    const message = error.message.includes("prepaid_not_paid")
      ? "先匯款的預約尚未完成付款，不能完成面交。"
      : "面交預約更新失敗。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data });
}

import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard(request: NextRequest, mutation = false) {
  if (getBackendRuntime() === "unknown") return new NextResponse("Not found", { status: 404 });
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("不允許跨來源操作。", 403);
  return null;
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    lineDisplayName: String(row.line_display_name || "LINE 使用者"),
    nickname: String(row.nickname || ""),
    requestedNickname: String(row.requested_nickname || ""),
    reviewStatus: String(row.review_status || "not_requested"),
    approvedAt: String(row.approved_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const rate = await backendRateLimit(request, "backend_community_members_list", 90);
  if (!rate.ok) return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("community_line_bindings")
      .select("id,line_display_name,nickname,requested_nickname,review_status,approved_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map((row) => mapRow(row as Record<string, unknown>));
    return NextResponse.json({
      ok: true,
      approved: rows.filter((row) => Boolean(row.nickname)),
      pending: rows.filter((row) => row.reviewStatus !== "approved" || Boolean(row.requestedNickname)),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "社群名單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

type CommunityMemberMutation = { id?: unknown; action?: unknown; nickname?: unknown };

async function validateNickname(
  service: ReturnType<typeof createSupabaseServiceClient>,
  id: string,
  lineUserId: string,
  nickname: string,
) {
  const [{ data: orders, error: lookupError }, { data: conflict, error: conflictError }] = await Promise.all([
    service.rpc("lookup_community_orders_by_nickname", { p_nickname: nickname }),
    service
      .from("community_line_bindings")
      .select("id")
      .ilike("nickname", nickname)
      .neq("line_user_id", lineUserId)
      .neq("id", id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (lookupError || conflictError) throw lookupError || conflictError;
  if (!Array.isArray(orders) || !orders.length) return "找不到這個社群暱稱的訂單。";
  if (conflict) return "這個社群暱稱已綁定其他 LINE 使用者。";
  return null;
}

export async function PATCH(request: NextRequest) {
  const denied = await guard(request, true);
  if (denied) return denied;
  const rate = await backendRateLimit(request, "backend_community_members_mutation", 60);
  if (!rate.ok) return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  let body: CommunityMemberMutation;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的操作資料。" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "缺少名單識別資料。" }, { status: 400 });
  const action = body.action === "edit" || body.action === "unbind" ? body.action : "approve";
  try {
    const service = createSupabaseServiceClient();
    const { data: row, error: readError } = await service
      .from("community_line_bindings")
      .select("line_user_id,nickname,requested_nickname,review_status,approved_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ ok: false, error: "找不到這筆綁定資料。" }, { status: 404 });
    if (action === "unbind") {
      const { data: updatedRow, error: updateError } = await service
        .from("community_line_bindings")
        .update({ nickname: null, requested_nickname: null, review_status: "not_requested", approved_at: null })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedRow) return NextResponse.json({ ok: false, error: "解除綁定失敗。" }, { status: 409 });
      return NextResponse.json({ ok: true, action: "unbind" });
    }
    const nickname = action === "edit"
      ? (typeof body.nickname === "string" ? body.nickname.trim().slice(0, 120) : "")
      : String(row.requested_nickname || "").trim();
    if (action === "approve" && (row.review_status !== "pending" || !nickname)) {
      return NextResponse.json({ ok: false, error: "這筆資料已不是待審核狀態。" }, { status: 409 });
    }
    if (action === "edit" && (!row.nickname || !nickname)) {
      return NextResponse.json({ ok: false, error: "請輸入社群暱稱。" }, { status: 400 });
    }
    const validationError = await validateNickname(service, id, String(row.line_user_id), nickname);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 409 });
    const approvedAt = new Date().toISOString();
    let updateQuery = service
      .from("community_line_bindings")
      .update({
        nickname,
        requested_nickname: null,
        review_status: "approved",
        approved_at: action === "approve" ? approvedAt : row.approved_at,
      })
      .eq("id", id);
    if (action === "approve") updateQuery = updateQuery.eq("review_status", "pending");
    const { data: updatedRow, error: updateError } = await updateQuery.select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updatedRow) return NextResponse.json({ ok: false, error: "資料已更新，請重新整理後再試。" }, { status: 409 });
    return NextResponse.json({ ok: true, action, nickname, approvedAt: action === "approve" ? approvedAt : row.approved_at });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = code === "23505" ? "這個社群暱稱已綁定其他 LINE 使用者。" : "社群名單更新失敗，請稍後再試。";
    return NextResponse.json({ ok: false, error: message }, { status: code === "23505" ? 409 : 500 });
  }
}

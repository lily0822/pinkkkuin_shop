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
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
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

export async function PATCH(request: NextRequest) {
  const denied = await guard(request, true);
  if (denied) return denied;
  const rate = await backendRateLimit(request, "backend_community_members_approve", 60);
  if (!rate.ok) return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的審核資料。" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "請提供正確的審核資料。" }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const { data: row, error: readError } = await service
      .from("community_line_bindings")
      .select("line_user_id,requested_nickname,review_status")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    const requestedNickname = String(row?.requested_nickname || "").trim();
    if (!row || row.review_status !== "pending" || !requestedNickname) {
      return NextResponse.json({ ok: false, error: "這筆申請已不是待審核狀態。" }, { status: 409 });
    }

    const { data: conflict, error: conflictError } = await service
      .from("community_line_bindings")
      .select("id")
      .ilike("nickname", requestedNickname)
      .neq("line_user_id", row.line_user_id)
      .limit(1)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) {
      return NextResponse.json({ ok: false, error: "這個社群暱稱已綁定其他 LINE 帳號。" }, { status: 409 });
    }

    const approvedAt = new Date().toISOString();
    const { data: updatedRow, error: updateError } = await service
      .from("community_line_bindings")
      .update({
        nickname: requestedNickname,
        requested_nickname: null,
        review_status: "approved",
        approved_at: approvedAt,
      })
      .eq("id", id)
      .eq("review_status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedRow) {
      return NextResponse.json({ ok: false, error: "這筆申請已被處理，請重新整理。" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, nickname: requestedNickname, approvedAt });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = code === "23505" ? "這個社群暱稱已綁定其他 LINE 帳號。" : "審核失敗，請稍後再試。";
    return NextResponse.json({ ok: false, error: message }, { status: code === "23505" ? 409 : 500 });
  }
}

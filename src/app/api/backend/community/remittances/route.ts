import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_remittances_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_list_community_remittances", { p_limit: 100 });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    return NextResponse.json({
      ok: true,
      remittances: rows.map((row) => ({
        id: String(row.id || ""),
        batchId: String(row.batch_id || row.id || ""),
        orderIds: Array.isArray(row.order_ids) ? row.order_ids.map(String) : [],
        nickname: String(row.nickname || ""),
        notebookNames: Array.isArray(row.notebook_names) ? row.notebook_names.map(String) : [],
        notebookDetails: Array.isArray(row.notebook_details) ? row.notebook_details.map((detail: Record<string, unknown>) => ({
          orderId: String(detail?.orderId || ""),
          notebookName: String(detail?.notebookName || ""),
          productTotal: Number(detail?.productTotal || 0),
          discountAmount: Number(detail?.discountAmount || 0),
          payableAmount: Number(detail?.payableAmount || 0),
        })) : [],
        productTotal: Number(row.product_total || 0),
        discountTotal: Number(row.discount_total || 0),
        bank: String(row.bank || ""),
        accountLast5: String(row.account_last5 || ""),
        amount: Number(row.amount || 0),
        expectedAmount: Number(row.expected_amount || 0),
        cumulativeReceived: Number(row.cumulative_received || 0),
        remainingAmount: Number(row.remaining_amount || 0),
        overpaidAmount: Number(row.overpaid_amount || 0),
        submittedAt: String(row.submitted_at || ""),
        status: String(row.status || "pending"),
        rejectionReason: String(row.rejection_reason || ""),
        reviewedAt: String(row.reviewed_at || ""),
        refundedAt: String(row.refunded_at || ""),
        refundAmount: Number(row.refund_amount || 0),
        refundCompletedAt: String(row.refund_completed_at || ""),
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "匯款回報讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_remittances_review", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { submissionId?: unknown; decision?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的審核資料。" }, { status: 400 });
  }

  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  const decision = body.decision === "approved" || body.decision === "rejected" || body.decision === "refund_completed"
    ? body.decision
    : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!submissionId || !decision || (decision === "rejected" && !reason)) {
    return NextResponse.json({ ok: false, error: "請提供完整的審核資料。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const rpc = decision === "refund_completed"
      ? supabase.rpc("backend_complete_community_refund", { p_submission_id: submissionId })
      : supabase.rpc("backend_review_community_remittance", {
          p_submission_id: submissionId,
          p_decision: decision,
          p_reason: decision === "rejected" ? reason : null,
        });
    const { data, error } = await rpc;
    if (error) throw error;
    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ ok: false, error: "付款審核失敗，請稍後再試。" }, { status: 500 });
  }
}

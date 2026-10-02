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

type RemittancePatch = {
  bankName?: unknown;
  accountLast5?: unknown;
  amount?: unknown;
  reviewed?: unknown;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_remittances_update", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const remittanceId = id?.trim();
  if (!remittanceId) return NextResponse.json({ ok: false, error: "缺少匯款紀錄識別資料。" }, { status: 400 });

  let body: RemittancePatch;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的更新資料。" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.bankName === "string") patch.bank_name = body.bankName.trim().slice(0, 50) || null;

  if (typeof body.accountLast5 === "string") {
    const last5 = body.accountLast5.trim();
    if (!/^\d{5}$/.test(last5)) {
      return NextResponse.json({ ok: false, error: "末五碼需為 5 碼數字。" }, { status: 400 });
    }
    patch.account_last5 = last5;
  }

  if (body.amount === null) {
    patch.amount = null;
  } else if (typeof body.amount === "number") {
    if (!Number.isFinite(body.amount) || body.amount < 0) {
      return NextResponse.json({ ok: false, error: "金額請輸入正確的數字。" }, { status: 400 });
    }
    patch.amount = body.amount;
  }

  // 標記已核對／取消標記——跟 community_livestream_orders 的任何狀態
  // 完全無關，純粹是這張表自己的處理進度（見 202610040001 migration）。
  if (typeof body.reviewed === "boolean") {
    patch.reviewed_at = body.reviewed ? new Date().toISOString() : null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "沒有可更新的欄位。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data: updated, error: updateError } = await supabase
      .from("community_livestream_remittances")
      .update(patch)
      .eq("id", remittanceId)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ ok: false, error: "更新失敗，請重新整理後再試。" }, { status: 409 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "匯款紀錄更新失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_remittances_delete", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const remittanceId = id?.trim();
  if (!remittanceId) return NextResponse.json({ ok: false, error: "缺少匯款紀錄識別資料。" }, { status: 400 });

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("community_livestream_remittances").delete().eq("id", remittanceId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "刪除失敗，請稍後再試。" }, { status: 500 });
  }
}

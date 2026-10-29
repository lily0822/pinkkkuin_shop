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
import { LIVESTREAM_STANDARD_BANK_NAMES } from "@/lib/line/livestream-bank-aliases";

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
  // 後台這欄從自由輸入框改成下拉選單（中信/富邦/國泰）——用來修正
  // 「異常」資料，所以只接受這三個標準名稱，不是任意字串了。
  if (typeof body.bankName === "string") {
    const bankName = body.bankName.trim();
    if (!LIVESTREAM_STANDARD_BANK_NAMES.includes(bankName)) {
      return NextResponse.json({ ok: false, error: "請選擇正確的銀行。" }, { status: 400 });
    }
    patch.bank_name = bankName;
  }

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

    // 階段二（結算模型）：remittance_id 現在只代表「這筆訂單第一次被
    // 匯款連到的那筆紀錄」，之後的補差額不會改寫它——所以這支路由只能
    // 安全刪除「這批訂單的 remittance_id 全部都等於這一筆」的紀錄（也
    // 就是這些訂單還沒有被補過差額），這種情況下直接把 paid_amount 歸
    // 零、remittance_id 清空、payment_status 退回 unpaid 是正確的（這筆
    // 本來就是這些訂單唯一的一次付款）。如果其中有任何一筆訂單的
    // remittance_id 不等於這一筆（代表那筆訂單後來又被補過差額，這筆
    // 紀錄只是其中一次付款，不是全部），貿然歸零 paid_amount 會把之後
    // 其他筆匯款累加上去的金額也一起清掉，造成金額對不起來——這種情況
    // 改請賣家用「標記已退款」處理（那條路徑用 shouldPay 重新結算，不
    // 是盲目清零，才不會算錯）。
    const { data: remittanceRow, error: fetchError } = await supabase
      .from("community_livestream_remittances")
      .select("order_ids")
      .eq("id", remittanceId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!remittanceRow) return NextResponse.json({ ok: false, error: "找不到這筆匯款紀錄。" }, { status: 404 });

    const orderIds = Array.isArray(remittanceRow.order_ids) ? remittanceRow.order_ids : [];
    if (orderIds.length) {
      const { data: relatedOrders, error: ordersError } = await supabase
        .from("community_livestream_orders")
        .select("id, remittance_id")
        .in("id", orderIds);
      if (ordersError) throw ordersError;

      const hasTopup = (relatedOrders || []).some((order) => String(order.remittance_id) !== remittanceId);
      if (hasTopup) {
        return NextResponse.json(
          { ok: false, error: "此筆匯款包含補款項目，無法直接刪除，請改用「標記已退款」處理。" },
          { status: 409 },
        );
      }

      const { error: unlinkError } = await supabase
        .from("community_livestream_orders")
        .update({ remittance_id: null, payment_status: "unpaid", paid_amount: 0 })
        .eq("remittance_id", remittanceId);
      if (unlinkError) throw unlinkError;
    }

    const { error } = await supabase.from("community_livestream_remittances").delete().eq("id", remittanceId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "刪除失敗，請稍後再試。" }, { status: 500 });
  }
}

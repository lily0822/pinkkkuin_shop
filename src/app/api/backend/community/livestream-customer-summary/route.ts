import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 跟 /api/backend/community/livestream-orders 的 500 筆 cap 不同——這支是
// 「依客人統計」要用的全量彙總，沒有分頁，直接抓一個夠大的上限，不是
// 真正的無限分頁（這個社群規模的量級下實務上足夠）。
const FETCH_LIMIT = 5000;

async function guardBackendRequest(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_customer_summary", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: orderRows, error: orderError }, { data: remittanceRows, error: remittanceError }] = await Promise.all([
      supabase
        .from("community_livestream_orders")
        .select("line_user_id, line_display_name, unit_price, quantity, created_at")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
      supabase
        .from("community_livestream_remittances")
        .select("line_user_id, amount, reviewed_at")
        .limit(FETCH_LIMIT),
    ]);
    if (orderError) throw orderError;
    if (remittanceError) throw remittanceError;

    const orders = Array.isArray(orderRows) ? orderRows : [];
    const remittances = Array.isArray(remittanceRows) ? remittanceRows : [];

    type CustomerAccumulator = {
      lineUserId: string;
      lineDisplayName: string;
      totalAmount: number;
      confirmedRemittanceAmount: number;
      pendingRemittanceAmount: number;
    };
    const byUserId = new Map<string, CustomerAccumulator>();

    function getAccumulator(userId: string): CustomerAccumulator {
      let accumulator = byUserId.get(userId);
      if (!accumulator) {
        accumulator = { lineUserId: userId, lineDisplayName: "", totalAmount: 0, confirmedRemittanceAmount: 0, pendingRemittanceAmount: 0 };
        byUserId.set(userId, accumulator);
      }
      return accumulator;
    }

    // orders 已經依 created_at desc 排序——同一個客人第一次出現的那一筆
    // 就是他最新一筆訂單，lineDisplayName 只在還沒設過時才寫入一次。
    orders.forEach((row) => {
      const userId = String(row.line_user_id || "");
      if (!userId) return;
      const accumulator = getAccumulator(userId);
      if (!accumulator.lineDisplayName) accumulator.lineDisplayName = String(row.line_display_name || "LINE 使用者");
      const unitPrice = row.unit_price === null || row.unit_price === undefined ? 0 : Number(row.unit_price);
      accumulator.totalAmount += unitPrice * Number(row.quantity || 1);
    });

    remittances.forEach((row) => {
      const userId = String(row.line_user_id || "");
      if (!userId) return;
      const accumulator = getAccumulator(userId);
      const amount = row.amount === null || row.amount === undefined ? 0 : Number(row.amount);
      if (row.reviewed_at) accumulator.confirmedRemittanceAmount += amount;
      else accumulator.pendingRemittanceAmount += amount;
    });

    return NextResponse.json({
      ok: true,
      customers: [...byUserId.values()].map((c) => ({
        lineUserId: c.lineUserId,
        lineDisplayName: c.lineDisplayName || "LINE 使用者",
        totalAmount: c.totalAmount,
        confirmedRemittanceAmount: c.confirmedRemittanceAmount,
        pendingRemittanceAmount: c.pendingRemittanceAmount,
        diffAmount: c.totalAmount - c.confirmedRemittanceAmount,
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "依客人統計讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

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

  const rate = await backendRateLimit(request, "backend_community_livestream_remittances_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const incoming = new URL(request.url);
  const q = (incoming.searchParams.get("q") || "").trim().toLocaleLowerCase().slice(0, 120);
  const reviewed = incoming.searchParams.get("reviewed") || "";

  try {
    const supabase = createSupabaseServiceClient();
    let query = supabase
      .from("community_livestream_remittances")
      .select("id, line_user_id, nickname, bank_name, account_last5, amount, order_ids, submitted_at, reviewed_at")
      .order("submitted_at", { ascending: false })
      .limit(500);

    if (reviewed === "1") query = query.not("reviewed_at", "is", null);
    if (reviewed === "0") query = query.is("reviewed_at", null);

    const { data, error } = await query;
    if (error) throw error;

    // 這張表只有 nickname 一個名稱欄位（提交當下 LINE 顯示名稱的快照，
    // 不像 community_livestream_orders 另外存了一份 line_display_name）——
    // 搜尋只比對這一欄，不是漏做「LINE 名稱」欄位的搜尋。
    const allRows = Array.isArray(data) ? data : [];
    const rows = q ? allRows.filter((row) => String(row.nickname || "").toLocaleLowerCase().includes(q)) : allRows;

    return NextResponse.json({
      ok: true,
      remittances: rows.map((row) => ({
        id: String(row.id || ""),
        nickname: String(row.nickname || ""),
        bankName: row.bank_name ? String(row.bank_name) : "",
        accountLast5: String(row.account_last5 || ""),
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        orderCount: Array.isArray(row.order_ids) ? row.order_ids.length : 0,
        submittedAt: String(row.submitted_at || ""),
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "匯款紀錄讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

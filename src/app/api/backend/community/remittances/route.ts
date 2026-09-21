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
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
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
        nickname: String(row.nickname || ""),
        notebookNames: Array.isArray(row.notebook_names) ? row.notebook_names.map(String) : [],
        bank: String(row.bank || ""),
        accountLast5: String(row.account_last5 || ""),
        amount: Number(row.amount || 0),
        expectedAmount: Number(row.expected_amount || 0),
        submittedAt: String(row.submitted_at || ""),
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "匯款回報讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

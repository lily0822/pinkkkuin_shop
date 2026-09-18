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

  const rate = await backendRateLimit(request, "backend_community_import_batches_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_import_batches")
      .select("id, source_filename, row_count, order_count, item_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      batches: (data || []).map((row) => ({
        id: String(row.id),
        sourceFilename: row.source_filename ? String(row.source_filename) : "",
        rowCount: Number(row.row_count || 0),
        orderCount: Number(row.order_count || 0),
        itemCount: Number(row.item_count || 0),
        createdAt: String(row.created_at || ""),
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "匯入批次讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

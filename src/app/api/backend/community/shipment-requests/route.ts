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

const ALLOWED_PAGE_SIZES = new Set([20, 50, 100]);

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

function cleanText(value: string | null) {
  return (value || "").trim();
}

function cleanPage(value: string | null) {
  const page = Number.parseInt(value || "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function cleanPageSize(value: string | null) {
  const size = Number.parseInt(value || "", 10);
  return ALLOWED_PAGE_SIZES.has(size) ? size : 50;
}

type ShipmentItem = { productName?: unknown; variantSpec?: unknown; quantity?: unknown };

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_shipment_requests_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const incoming = new URL(request.url);
  const q = cleanText(incoming.searchParams.get("q")).slice(0, 120);
  const page = cleanPage(incoming.searchParams.get("page"));
  const pageSize = cleanPageSize(incoming.searchParams.get("page_size"));

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_list_community_shipment_requests", {
      p_q: q,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const total = Number(rows[0]?.total_count || 0);
    return NextResponse.json({
      ok: true,
      requests: rows.map((row) => ({
        id: String(row.id || ""),
        nickname: String(row.nickname || ""),
        notebookNames: Array.isArray(row.notebook_names) ? row.notebook_names.map(String) : [],
        items: (Array.isArray(row.items) ? row.items : []).map((item: ShipmentItem) => ({
          productName: String(item.productName || ""),
          variantSpec: item.variantSpec ? String(item.variantSpec) : "",
          quantity: Number(item.quantity || 0),
        })),
        recipientName: String(row.recipient_name || ""),
        phone: String(row.phone || ""),
        pickupStore: String(row.pickup_store || ""),
        status: String(row.status || "pending"),
        submittedAt: String(row.submitted_at || ""),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total > 0 ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "出貨申請讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

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

const ALLOWED_PAYMENT_STATUSES = new Set(["unpaid", "paid", "in_person"]);
const ALLOWED_ARRIVAL_STATUSES = new Set(["not_shipped", "shipped_japan", "shipped_korea", "arrived_taiwan"]);
const ALLOWED_ORDER_STAGES = new Set(["open", "in_person"]);
const ALLOWED_PAGE_SIZES = new Set([20, 50, 100]);

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

async function rateLimitResponse(request: NextRequest, scope: string, limit: number) {
  const rate = await backendRateLimit(request, scope, limit);
  if (rate.ok) return null;
  return NextResponse.json(
    { ok: false, error: "操作太頻繁，請稍後再試。" },
    { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
  );
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

function mapRow(row: Record<string, unknown>) {
  return {
    orderId: String(row.order_id || ""),
    notebookName: String(row.notebook_name || ""),
    nickname: String(row.nickname || ""),
    paymentStatus: String(row.payment_status || "unpaid"),
    arrivalStatus: String(row.arrival_status || "not_shipped"),
    orderStage: String(row.order_stage || "open"),
    notes: String(row.notes || ""),
    orderCreatedAt: String(row.order_created_at || ""),
    itemId: String(row.item_id || ""),
    productName: String(row.product_name || ""),
    variantSpec: row.variant_spec ? String(row.variant_spec) : "",
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    itemSubtotal: Number(row.item_subtotal || 0),
    snipeStatus: String(row.snipe_status || "pending"),
    groupTotal: Number(row.group_total || 0),
    remitAmount: Number(row.remit_amount || 0),
    groupFirst: Boolean(row.group_first),
  };
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;
  const rateLimit = await rateLimitResponse(request, "backend_community_orders_list", 90);
  if (rateLimit) return rateLimit;

  const incoming = new URL(request.url);
  const q = cleanText(incoming.searchParams.get("q")).slice(0, 120);
  const page = cleanPage(incoming.searchParams.get("page"));
  const pageSize = cleanPageSize(incoming.searchParams.get("page_size"));

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_list_community_orders", {
      p_q: q,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const total = Number(rows[0]?.total_count || 0);
    return NextResponse.json({
      ok: true,
      rows: rows.map((row) => mapRow(row as Record<string, unknown>)),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total > 0 ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "社群訂單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;
  const rateLimit = await rateLimitResponse(request, "backend_community_orders_update", 60);
  if (rateLimit) return rateLimit;

  let body: {
    orderId?: unknown;
    paymentStatus?: unknown;
    arrivalStatus?: unknown;
    orderStage?: unknown;
    notes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的訂單資料。" }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "請提供正確的訂單資料。" }, { status: 400 });
  }

  const paymentStatus =
    typeof body.paymentStatus === "string" && ALLOWED_PAYMENT_STATUSES.has(body.paymentStatus)
      ? body.paymentStatus
      : null;
  const arrivalStatus =
    typeof body.arrivalStatus === "string" && ALLOWED_ARRIVAL_STATUSES.has(body.arrivalStatus)
      ? body.arrivalStatus
      : null;
  const orderStage =
    typeof body.orderStage === "string" && ALLOWED_ORDER_STAGES.has(body.orderStage) ? body.orderStage : null;
  const notesSet = typeof body.notes === "string";
  const notes = notesSet ? (body.notes as string).slice(0, 2000) : null;

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.rpc("backend_update_community_order", {
      p_order_id: orderId,
      p_payment_status: paymentStatus,
      p_arrival_status: arrivalStatus,
      p_order_stage: orderStage,
      p_notes: notes,
      p_notes_set: notesSet,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "社群訂單更新失敗，請稍後再試。" }, { status: 500 });
  }
}

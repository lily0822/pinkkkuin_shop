import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enrichCommunityOrderRows, enrichCommunityPaymentRows } from "@/lib/community-order-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

async function rateLimited(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_hit_rate_limit", {
      p_scope: "public_community_orders_lookup",
      p_bucket_key: clientKey(request),
      p_limit: 30,
      p_window_seconds: 60,
    });
    if (error) return false;
    const row = Array.isArray(data) ? data[0] : data;
    return !row?.allowed;
  } catch {
    return false;
  }
}

function mapRow(row: Record<string, unknown>) {
  return {
    orderId: String(row.order_id || ""),
    notebookName: String(row.notebook_name || ""),
    paymentStatus: String(row.payment_status || "unpaid"),
    arrivalStatus: String(row.arrival_status || "not_shipped"),
    orderStage: String(row.order_stage || "open"),
    orderCreatedAt: String(row.order_created_at || ""),
    itemId: String(row.item_id || ""),
    productName: String(row.product_name || ""),
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
  if (await rateLimited(request)) {
    return NextResponse.json({ ok: false, error: "查詢太頻繁，請稍後再試。" }, { status: 429 });
  }

  const incoming = new URL(request.url);
  const nickname = (incoming.searchParams.get("nickname") || "").trim().slice(0, 120);
  if (!nickname) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("lookup_community_orders_by_nickname", {
      p_nickname: nickname,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const mappedRows = rows.map((row) => mapRow(row as Record<string, unknown>));
    const itemRows = await enrichCommunityOrderRows(supabase, mappedRows);
    return NextResponse.json({ ok: true, rows: await enrichCommunityPaymentRows(supabase, itemRows) });
  } catch {
    return NextResponse.json({ ok: false, error: "查詢失敗，請稍後再試。" }, { status: 500 });
  }
}

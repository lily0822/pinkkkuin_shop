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
    const nicknames = [...new Set(rows.map((row) => String(row.nickname || "")).filter(Boolean))];
    const lineNames = new Map<string, string>();
    if (nicknames.length) {
      const { data: bindings, error: bindingsError } = await supabase
        .from("community_line_bindings")
        .select("nickname,line_display_name")
        .in("nickname", nicknames);
      if (bindingsError) throw bindingsError;
      for (const binding of bindings || []) {
        lineNames.set(String(binding.nickname || "").trim().toLocaleLowerCase(), String(binding.line_display_name || "LINE 使用者"));
      }
    }

    // Per-notebook item breakdown for the admin expand view. Built here with
    // plain queries (order_ids -> orders -> items) instead of changing the
    // RPC, so no migration is needed.
    const requestIds = rows.map((row) => String(row.id || "")).filter(Boolean);
    const orderIdsByRequest = new Map<string, string[]>();
    const allOrderIds = new Set<string>();
    if (requestIds.length) {
      const { data: requestRows, error: requestRowsError } = await supabase
        .from("community_shipment_requests")
        .select("id, order_ids")
        .in("id", requestIds);
      if (requestRowsError) throw requestRowsError;
      for (const row of requestRows || []) {
        const orderIds = (Array.isArray(row.order_ids) ? row.order_ids : []).map(String).filter(Boolean);
        orderIdsByRequest.set(String(row.id || ""), orderIds);
        orderIds.forEach((orderId) => allOrderIds.add(orderId));
      }
    }
    const notebookNameByOrderId = new Map<string, string>();
    const itemsByOrderId = new Map<string, { productName: string; variantSpec: string; quantity: number }[]>();
    if (allOrderIds.size) {
      const orderIdList = Array.from(allOrderIds);
      const [{ data: orderRows, error: orderRowsError }, { data: itemRows, error: itemRowsError }] = await Promise.all([
        supabase.from("community_orders").select("id, notebook_name").in("id", orderIdList),
        supabase
          .from("community_order_items")
          .select("order_id, product_name, variant_spec, quantity, purchase_status")
          .in("order_id", orderIdList)
          .eq("purchase_status", "bought"),
      ]);
      if (orderRowsError) throw orderRowsError;
      if (itemRowsError) throw itemRowsError;
      for (const row of orderRows || []) {
        notebookNameByOrderId.set(String(row.id || ""), String(row.notebook_name || "未命名記事本"));
      }
      for (const row of itemRows || []) {
        const orderId = String(row.order_id || "");
        const list = itemsByOrderId.get(orderId) || [];
        list.push({
          productName: String(row.product_name || ""),
          variantSpec: row.variant_spec ? String(row.variant_spec) : "",
          quantity: Number(row.quantity || 0) || 1,
        });
        itemsByOrderId.set(orderId, list);
      }
    }
    function notebookGroupsForRequest(requestId: string) {
      const orderIds = orderIdsByRequest.get(requestId) || [];
      const byNotebook = new Map<string, { productName: string; variantSpec: string; quantity: number }[]>();
      for (const orderId of orderIds) {
        const notebookName = notebookNameByOrderId.get(orderId) || "未命名記事本";
        const items = itemsByOrderId.get(orderId) || [];
        const list = byNotebook.get(notebookName) || [];
        list.push(...items);
        byNotebook.set(notebookName, list);
      }
      return Array.from(byNotebook.entries()).map(([notebookName, items]) => ({ notebookName, items }));
    }

    return NextResponse.json({
      ok: true,
      requests: rows.map((row) => ({
        id: String(row.id || ""),
        nickname: String(row.nickname || ""),
        lineDisplayName: lineNames.get(String(row.nickname || "").trim().toLocaleLowerCase()) || "LINE 使用者",
        notebookNames: Array.isArray(row.notebook_names) ? row.notebook_names.map(String) : [],
        notebookGroups: notebookGroupsForRequest(String(row.id || "")),
        items: (Array.isArray(row.items) ? row.items : []).map((item: ShipmentItem) => ({
          productName: String(item.productName || ""),
          variantSpec: item.variantSpec ? String(item.variantSpec) : "",
          quantity: Number(item.quantity || 0),
        })),
        recipientName: String(row.recipient_name || ""),
        phone: String(row.phone || ""),
        pickupStore: String(row.pickup_store || ""),
        shippingMethod: String(row.shipping_method || "seven_eleven"),
        notebookSnapshot: Array.isArray(row.notebook_snapshot) ? row.notebook_snapshot : [],
        marketplaceUrl: String(row.marketplace_url || ""),
        marketplaceOrderRef: String(row.marketplace_order_ref || ""),
        status: String(row.status || "pending"),
        submittedAt: String(row.submitted_at || ""),
        acceptedAt: String(row.accepted_at || ""),
        completedAt: String(row.completed_at || ""),
        cancelledAt: String(row.cancelled_at || ""),
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

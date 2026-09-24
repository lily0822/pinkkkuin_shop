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

async function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") return new NextResponse("Not found", { status: 404 });
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

const SHIPMENT_TIME_PRECISIONS = new Set(["unknown", "early", "mid", "late", "end_of_month", "exact"]);

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;
  const rate = await backendRateLimit(request, "backend_community_notebooks_list", 60);
  if (!rate.ok) {
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_list_community_notebooks");
    if (error) throw error;

    // Admin-entered 訂購日期/預計出貨 metadata, keyed by notebook name. Kept in
    // its own table (community_notebooks) so it degrades cleanly — a
    // notebook with no row here just has empty fields below.
    const metaByName = new Map<string, Record<string, unknown>>();
    try {
      const { data: metaRows, error: metaError } = await supabase
        .from("community_notebooks")
        .select("notebook_name, ordered_date, expected_shipment_month, expected_shipment_precision, expected_shipment_date");
      if (metaError) throw metaError;
      for (const row of metaRows || []) {
        metaByName.set(String(row.notebook_name || ""), row);
      }
    } catch {
      // ignore — table not migrated yet or query failed, just show no meta
    }

    const notebooks = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const notebookName = String(row.notebook_name || "");
      const meta = metaByName.get(notebookName);
      return {
        notebookName,
        customerCount: Number(row.customer_count || 0),
        itemCount: Number(row.item_count || 0),
        boughtQuantity: Number(row.bought_quantity || 0),
        notBoughtQuantity: Number(row.not_bought_quantity || 0),
        arrivedBoughtQuantity: Number(row.arrived_bought_quantity || 0),
        notArrivedBoughtQuantity: Number(row.not_arrived_bought_quantity || 0),
        exceptionBoughtQuantity: Number(row.exception_bought_quantity || 0),
        orderedDate: meta?.ordered_date ? String(meta.ordered_date) : "",
        expectedShipmentMonth: meta?.expected_shipment_month ? String(meta.expected_shipment_month) : "",
        expectedShipmentPrecision: meta?.expected_shipment_precision ? String(meta.expected_shipment_precision) : "unknown",
        expectedShipmentDate: meta?.expected_shipment_date ? String(meta.expected_shipment_date) : "",
      };
    });
    return NextResponse.json({ ok: true, notebooks });
  } catch {
    return NextResponse.json({ ok: false, error: "記事本資料讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;
  const rate = await backendRateLimit(request, "backend_community_notebooks_meta_save", 30);
  if (!rate.ok) {
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  }

  let body: {
    notebookName?: unknown;
    orderedDate?: unknown;
    expectedShipmentMonth?: unknown;
    expectedShipmentPrecision?: unknown;
    expectedShipmentDate?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的記事本時間資料。" }, { status: 400 });
  }

  const notebookName = typeof body.notebookName === "string" ? body.notebookName.trim().slice(0, 200) : "";
  if (!notebookName) {
    return NextResponse.json({ ok: false, error: "請提供正確的記事本名稱。" }, { status: 400 });
  }
  const precision = typeof body.expectedShipmentPrecision === "string" ? body.expectedShipmentPrecision : "unknown";
  if (!SHIPMENT_TIME_PRECISIONS.has(precision)) {
    return NextResponse.json({ ok: false, error: "請選擇正確的預計出貨時間描述。" }, { status: 400 });
  }
  const orderedDate = typeof body.orderedDate === "string" && body.orderedDate ? body.orderedDate : null;
  const expectedShipmentMonth =
    typeof body.expectedShipmentMonth === "string" && body.expectedShipmentMonth ? body.expectedShipmentMonth : null;
  const expectedShipmentDate =
    typeof body.expectedShipmentDate === "string" && body.expectedShipmentDate ? body.expectedShipmentDate : null;

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("community_notebooks").upsert(
      {
        notebook_name: notebookName,
        ordered_date: orderedDate,
        expected_shipment_month: precision === "exact" ? null : expectedShipmentMonth,
        expected_shipment_precision: precision,
        expected_shipment_date: precision === "exact" ? expectedShipmentDate : null,
      },
      { onConflict: "notebook_name" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "記事本時間資料儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;
  const rate = await backendRateLimit(request, "backend_community_notebooks_arrive", 30);
  if (!rate.ok) {
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  }

  let body: { notebookName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的記事本名稱。" }, { status: 400 });
  }
  const notebookName = typeof body.notebookName === "string" ? body.notebookName.trim().slice(0, 200) : "";
  if (!notebookName) {
    return NextResponse.json({ ok: false, error: "請提供正確的記事本名稱。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_mark_community_notebook_arrived", {
      p_notebook_name: notebookName,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, updatedCount: Number(data || 0) });
  } catch {
    return NextResponse.json({ ok: false, error: "記事本到貨狀態更新失敗，請稍後再試。" }, { status: 500 });
  }
}

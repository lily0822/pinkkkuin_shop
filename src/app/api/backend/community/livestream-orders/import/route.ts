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

const MAX_ROWS = 1000;

type ImportRow = {
  line_display_name: string;
  nickname: string;
  product_name: string;
  quantity: number;
  unit_price: number | null;
  notes: string;
};

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

function cleanRow(value: unknown): ImportRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const nickname = typeof row.nickname === "string" ? row.nickname.trim().slice(0, 200) : "";
  const productName = typeof row.product_name === "string" ? row.product_name.trim().slice(0, 300) : "";
  if (!nickname || !productName) return null;

  const lineDisplayName = typeof row.line_display_name === "string" ? row.line_display_name.trim().slice(0, 200) : "";
  const quantity = Math.max(1, Math.round(Number(row.quantity) || 1));
  const unitPriceRaw = Number(row.unit_price);
  const hasUnitPrice = row.unit_price !== "" && row.unit_price !== null && row.unit_price !== undefined && Number.isFinite(unitPriceRaw) && unitPriceRaw >= 0;
  const notes = typeof row.notes === "string" ? row.notes.trim().slice(0, 2000) : "";

  return {
    line_display_name: lineDisplayName,
    nickname,
    product_name: productName,
    quantity,
    unit_price: hasUnitPrice ? unitPriceRaw : null,
    notes,
  };
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_import", 10);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的匯入資料。" }, { status: 400 });
  }

  const rawRows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  const rows = rawRows.map(cleanRow).filter((row): row is ImportRow => row !== null);
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "沒有可匯入的資料列，請確認 Excel 內容與標題列。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("community_livestream_orders").insert(
      rows.map((row) => ({
        line_user_id: null,
        line_display_name: row.line_display_name || null,
        nickname: row.nickname,
        product_name: row.product_name,
        unit_price: row.unit_price,
        quantity: row.quantity,
        notes: row.notes || null,
        source: "excel_import",
      })),
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, importedCount: rows.length });
  } catch {
    return NextResponse.json({ ok: false, error: "匯入失敗，請稍後再試。" }, { status: 500 });
  }
}

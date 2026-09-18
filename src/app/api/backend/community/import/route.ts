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

const MAX_ROWS = 2000;

type ImportRow = {
  notebook_name: string;
  nickname: string;
  product_name: string;
  variant_spec: string;
  quantity: number;
  unit_price: number;
};

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
  if (!isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

function cleanRow(value: unknown): ImportRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const notebookName = typeof row.notebook_name === "string" ? row.notebook_name.trim().slice(0, 200) : "";
  const nickname = typeof row.nickname === "string" ? row.nickname.trim().slice(0, 200) : "";
  const productName = typeof row.product_name === "string" ? row.product_name.trim().slice(0, 300) : "";
  const variantSpec = typeof row.variant_spec === "string" ? row.variant_spec.trim().slice(0, 200) : "";
  const quantity = Math.max(1, Math.round(Number(row.quantity) || 1));
  const unitPrice = Math.max(0, Number(row.unit_price) || 0);
  if (!notebookName || !nickname || !productName) return null;
  return {
    notebook_name: notebookName,
    nickname,
    product_name: productName,
    variant_spec: variantSpec,
    quantity,
    unit_price: unitPrice,
  };
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_import", 10);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { filename?: unknown; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的匯入資料。" }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  const rawRows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  const rows = rawRows.map(cleanRow).filter((row): row is ImportRow => row !== null);

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "沒有可匯入的有效資料列。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_import_community_orders", {
      p_source_filename: filename || null,
      p_rows: rows,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ ok: false, error: "匯入失敗，請稍後再試。" }, { status: 500 });
  }
}

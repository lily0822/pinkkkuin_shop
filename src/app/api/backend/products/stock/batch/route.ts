import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { deleteBackendProductsBatch, saveBackendProductsBatch, type BackendProductPayload } from "@/lib/backend/product-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BATCH_SIZE = 200;

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

// 批次 API 只在這裡驗證一次身份/流量限制，不是每一筆商品各自驗證一次。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_products_stock_batch_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { products?: BackendProductPayload[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的商品資料。" }, { status: 400 });
  }

  const products = Array.isArray(body.products) ? body.products : [];
  if (!products.length) return NextResponse.json({ ok: false, error: "請至少提供一筆商品。" }, { status: 400 });
  if (products.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ ok: false, error: `單次批次最多 ${MAX_BATCH_SIZE} 筆。` }, { status: 400 });
  }

  // 個別商品的失敗已經包在每一筆的結果裡，不會讓整批回 500。
  const results = await saveBackendProductsBatch("stock", products);
  return NextResponse.json({ ok: true, results });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_products_stock_batch_delete", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的商品 id 清單。" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id).trim()).filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "請至少提供一筆商品 id。" }, { status: 400 });
  if (ids.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ ok: false, error: `單次批次最多 ${MAX_BATCH_SIZE} 筆。` }, { status: 400 });
  }

  const results = await deleteBackendProductsBatch("stock", ids);
  return NextResponse.json({ ok: true, results });
}

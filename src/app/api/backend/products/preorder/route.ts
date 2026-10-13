import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { listBackendProducts, saveBackendProduct, type BackendProductPayload } from "@/lib/backend/product-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// 上一輪商品存檔/刪除遷移時刻意沒做列表讀取，後台列表當時還是靠 Apps
// Script 的 doGet()/readData() 供應；這次補上，欄位對應原樣比照 .gs 的
// readSupabaseProducts()，回傳形狀跟後台前端原本預期的
// stockProducts/preorderProducts 元素完全一致。
export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_products_preorder_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const products = await listBackendProducts("preorder");
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    console.error("listBackendProducts(preorder) failed:", error);
    return NextResponse.json({ ok: false, error: "商品列表讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_products_preorder_save", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: BackendProductPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的商品資料。" }, { status: 400 });
  }

  if (!payload?.name) {
    return NextResponse.json({ ok: false, error: "請填寫商品名稱。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendProduct("preorder", payload);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("saveBackendProduct(preorder) failed:", error);
    return NextResponse.json({ ok: false, error: "商品儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

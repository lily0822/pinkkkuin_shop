import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { listBackendCategories, saveBackendCategory, type BackendCategoryPayload } from "@/lib/backend/category-sync";

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

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_product_tags_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const tags = await listBackendCategories();
    return NextResponse.json({ ok: true, tags });
  } catch (error) {
    console.error("listBackendCategories failed:", error);
    return NextResponse.json({ ok: false, error: "商品標籤讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_product_tags_save", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: BackendCategoryPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的標籤資料。" }, { status: 400 });
  }

  if (!payload?.name) {
    return NextResponse.json({ ok: false, error: "請填寫標籤名稱。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendCategory(payload);
    return NextResponse.json({ ok: true, tag: saved });
  } catch (error) {
    console.error("saveBackendCategory failed:", error);
    return NextResponse.json({ ok: false, error: "商品標籤儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

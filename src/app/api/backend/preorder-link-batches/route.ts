import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { saveLinkBatch } from "@/lib/line/preorder-link-batches";
import { getPreorderLinkSettings } from "@/lib/line/preorder-link-settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

// 「產生預購連結」工具：選一個既有 IP／商品類別標籤 + 輸入這批的顯示
// 名稱，組出完整的 oaMessage 連結。後台畫面上的標籤 id 是 legacy_id
// （見 src/lib/backend/category-sync.ts 的 mapCategoryRow），這裡要
// 先解析回真正的 Supabase categories.id，才能讓 webhook 那邊用
// product_categories.category_id 查商品查得到——不是直接信任前端傳
// 的值就是真的 uuid。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_preorder_link_batches_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { batchName?: unknown; tagId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const batchName = String(body.batchName || "").trim();
  const tagId = String(body.tagId || "").trim();
  if (!batchName) return NextResponse.json({ ok: false, error: "請輸入這批的顯示名稱。" }, { status: 400 });
  if (!tagId) return NextResponse.json({ ok: false, error: "請選擇對應的 IP／商品類別標籤。" }, { status: 400 });

  const basicId = process.env.LINE_OA_BASIC_ID?.trim();
  if (!basicId) {
    return NextResponse.json(
      { ok: false, error: "尚未設定 LINE 官方帳號 ID，請先在環境變數設定 LINE_OA_BASIC_ID。" },
      { status: 500 },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    let categoryId: string | null = null;

    const { data: byLegacyId } = await supabase.from("categories").select("id").eq("legacy_id", tagId).maybeSingle();
    categoryId = byLegacyId?.id || null;
    if (!categoryId && isUuid(tagId)) {
      const { data: byId } = await supabase.from("categories").select("id").eq("id", tagId).maybeSingle();
      categoryId = byId?.id || null;
    }
    if (!categoryId) {
      return NextResponse.json({ ok: false, error: "找不到對應的標籤，請重新整理後再試。" }, { status: 404 });
    }

    await saveLinkBatch(batchName, categoryId);

    const settings = await getPreorderLinkSettings();
    const message = `${batchName}｜${settings.oaMessagePrefix}`;
    const link = `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(message)}`;

    return NextResponse.json({ ok: true, link });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "連結產生失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}

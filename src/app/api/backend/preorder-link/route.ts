import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
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

// 「產生預購連結」工具：這一輪改成選一個既有的預購系列（product_series），
// 系列名稱直接當批次識別文字——不再是「選標籤 + 自己打顯示名稱」再存進
// 一張 KV 對照表（preorder-link-batches.ts，已拿掉）。webhook 收到客人
// 訊息解析出批次名稱後，直接查 product_series.name 就能拿到 series id，
// 少一層間接。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_preorder_link_save", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: { seriesId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const seriesId = String(body.seriesId || "").trim();
  if (!seriesId) return NextResponse.json({ ok: false, error: "請選擇對應的預購系列。" }, { status: 400 });

  const basicId = process.env.LINE_OA_BASIC_ID?.trim();
  if (!basicId) {
    return NextResponse.json(
      { ok: false, error: "尚未設定 LINE 官方帳號 ID，請先在環境變數設定 LINE_OA_BASIC_ID。" },
      { status: 500 },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data: series } = await supabase.from("product_series").select("id,name").eq("id", seriesId).maybeSingle();
    if (!series?.name) {
      return NextResponse.json({ ok: false, error: "找不到對應的系列，請重新整理後再試。" }, { status: 404 });
    }

    const settings = await getPreorderLinkSettings();
    const message = `${series.name}｜${settings.oaMessagePrefix}`;
    const link = `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(message)}`;

    return NextResponse.json({ ok: true, link });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "連結產生失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}

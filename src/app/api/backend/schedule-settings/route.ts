import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { listBackendScheduleSettings, saveBackendScheduleSetting } from "@/lib/backend/schedule-settings-sync";

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

// 品牌管理整包設定（品牌/素材/網站資訊/首頁內容/側邊欄模組順序/商品
// 預設佔位圖）全部走同一支通用 type-as-key 的 schedule_settings 路由，
// 不分開開路由——跟 GAS 端的 saveScheduleSetting 是同一支函式處理
// 所有 type 一致。?types=a,b,c 可以只拿需要的幾個 type，不傳就整包回傳。
export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_schedule_settings_list", 80);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const typesParam = request.nextUrl.searchParams.get("types");
  const types = typesParam
    ? typesParam
        .split(",")
        .map((type) => type.trim())
        .filter(Boolean)
    : undefined;

  try {
    const settings = await listBackendScheduleSettings(types);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    console.error("listBackendScheduleSettings failed:", error);
    return NextResponse.json({ ok: false, error: "設定讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_schedule_settings_save", 40);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: { type?: string; image?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的設定資料。" }, { status: 400 });
  }

  if (!payload?.type) {
    return NextResponse.json({ ok: false, error: "請提供設定的 type。" }, { status: 400 });
  }

  try {
    const saved = await saveBackendScheduleSetting(payload.type, payload.image ?? "");
    return NextResponse.json({ ok: true, setting: saved });
  } catch (error) {
    console.error("saveBackendScheduleSetting failed:", error);
    return NextResponse.json({ ok: false, error: "設定儲存失敗，請稍後再試。" }, { status: 500 });
  }
}

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
import { notifyCommunityNotebookArrived } from "@/lib/line/community-notifications";

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
    const notebooks = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
      notebookName: String(row.notebook_name || ""),
      customerCount: Number(row.customer_count || 0),
      itemCount: Number(row.item_count || 0),
      boughtQuantity: Number(row.bought_quantity || 0),
      notBoughtQuantity: Number(row.not_bought_quantity || 0),
      arrivedBoughtQuantity: Number(row.arrived_bought_quantity || 0),
      notArrivedBoughtQuantity: Number(row.not_arrived_bought_quantity || 0),
      exceptionBoughtQuantity: Number(row.exception_bought_quantity || 0),
    }));
    return NextResponse.json({ ok: true, notebooks });
  } catch {
    return NextResponse.json({ ok: false, error: "記事本資料讀取失敗，請稍後再試。" }, { status: 500 });
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
    const updatedCount = Number(data || 0);
    if (updatedCount > 0) {
      try {
        await notifyCommunityNotebookArrived(notebookName);
      } catch {
        // Notification is best-effort and must never affect the arrival update response.
      }
    }
    return NextResponse.json({ ok: true, updatedCount });
  } catch {
    return NextResponse.json({ ok: false, error: "記事本到貨狀態更新失敗，請稍後再試。" }, { status: 500 });
  }
}

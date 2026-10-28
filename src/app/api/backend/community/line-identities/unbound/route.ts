import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_LIMIT = 5000;

async function guardBackendRequest(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  return null;
}

type OrderRow = { line_user_id: string | null; line_display_name: string | null; created_at: string | null };

// 「在連線訂單裡出現過，但沒有綁定資料」的名單——給後台「幫他綁定」用。
// 統一綁定（2026-10-29）之後 community_line_identities 是唯一的綁定
// 資料來源（舊表已核准的資料都搬移過去了），不用再跟舊表 UNION。純粹
// JOIN 的概念，但 Supabase JS client 沒有 group by，改成抓一份訂單資料
// 自己在這裡依 line_user_id 聚合成「最近一筆訂單時間」，跟
// livestream-customer-summary 那支路由同一種做法。
export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_identities_unbound", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: orderData, error: orderError }, { data: identityData, error: identityError }] = await Promise.all([
      supabase
        .from("community_livestream_orders")
        .select("line_user_id, line_display_name, created_at")
        .eq("order_status", "submitted")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
      supabase.from("community_line_identities").select("line_user_id").limit(FETCH_LIMIT),
    ]);
    if (orderError) throw orderError;
    if (identityError) throw identityError;

    const boundIds = new Set<string>(
      ((identityData as { line_user_id: string }[] | null) || []).map((row) => row.line_user_id),
    );

    const latestByUser = new Map<string, { lineDisplayName: string; lastOrderAt: string }>();
    ((orderData as OrderRow[] | null) || []).forEach((row) => {
      const userId = row.line_user_id;
      if (!userId || boundIds.has(userId) || latestByUser.has(userId)) return;
      // 已經依 created_at desc 排序，第一次遇到這個 line_user_id 就是最新一筆。
      latestByUser.set(userId, { lineDisplayName: row.line_display_name || "LINE 使用者", lastOrderAt: row.created_at || "" });
    });

    const customers = [...latestByUser.entries()].map(([lineUserId, info]) => ({
      lineUserId,
      lineDisplayName: info.lineDisplayName,
      lastOrderAt: info.lastOrderAt,
    }));

    return NextResponse.json({ ok: true, customers });
  } catch {
    return NextResponse.json({ ok: false, error: "尚未綁定客人清單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

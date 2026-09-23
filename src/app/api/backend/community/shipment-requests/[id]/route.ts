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
import { notifyCommunityMarketplaceReady } from "@/lib/line/community-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["pending", "accepted", "completed", "cancelled"]);

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_shipment_requests_update", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const requestId = id?.trim();
  if (!requestId) {
    return NextResponse.json({ ok: false, error: "請提供正確的出貨申請資料。" }, { status: 400 });
  }

  let body: { status?: unknown; marketplaceUrl?: unknown; marketplaceOrderRef?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的狀態。" }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status.trim() : "";
  const marketplaceUrl = typeof body.marketplaceUrl === "string" ? body.marketplaceUrl.trim().slice(0, 1000) : "";
  const marketplaceOrderRef = typeof body.marketplaceOrderRef === "string" ? body.marketplaceOrderRef.trim().slice(0, 200) : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: "請提供正確的狀態。" }, { status: 400 });
  }
  if (marketplaceUrl && !/^https:\/\//i.test(marketplaceUrl)) {
    return NextResponse.json({ ok: false, error: "賣貨便連結必須使用 HTTPS。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();

    let shouldNotifyMarketplaceReady = false;
    let nicknameForNotification = "";
    if (marketplaceUrl) {
      const { data: beforeRow } = await supabase
        .from("community_shipment_requests")
        .select("nickname, marketplace_url")
        .eq("id", requestId)
        .maybeSingle();
      if (beforeRow && !String(beforeRow.marketplace_url || "").trim()) {
        shouldNotifyMarketplaceReady = true;
        nicknameForNotification = String(beforeRow.nickname || "");
      }
    }

    const { data, error } = await supabase.rpc("backend_update_community_shipment_status", {
      p_id: requestId,
      p_status: status,
      p_marketplace_url: marketplaceUrl || null,
      p_marketplace_order_ref: marketplaceOrderRef || null,
    });
    if (error) throw error;

    if (shouldNotifyMarketplaceReady && nicknameForNotification) {
      try {
        await notifyCommunityMarketplaceReady(requestId, nicknameForNotification, marketplaceUrl);
      } catch {
        // Notification is best-effort and must never affect the status update response.
      }
    }

    return NextResponse.json({ ok: true, status, result: data });
  } catch {
    return NextResponse.json({ ok: false, error: "狀態更新失敗，請稍後再試。" }, { status: 500 });
  }
}

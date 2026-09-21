import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCommunityLineBinding } from "@/lib/community-line-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

async function rateLimited(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_hit_rate_limit", {
      p_scope: "public_community_shipment_submit",
      p_bucket_key: clientKey(request),
      p_limit: 10,
      p_window_seconds: 60,
    });
    if (error) return false;
    const row = Array.isArray(data) ? data[0] : data;
    return !row?.allowed;
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendlyError(message: string) {
  if (message.includes("not_all_arrived")) return "所選系列中有商品尚未到貨，請重新確認。";
  if (message.includes("order_nickname_mismatch")) return "訂單資料有誤，請重新查詢後再試。";
  return "送出失敗，請稍後再試。";
}

export async function POST(request: NextRequest) {
  const binding = await getCommunityLineBinding(request);
  if (!binding) {
    return NextResponse.json({ ok: false, error: "請先使用 LINE 登入並綁定社群暱稱。" }, { status: 401 });
  }
  if (await rateLimited(request)) {
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  }

  let body: { nickname?: unknown; orderIds?: unknown; recipientName?: unknown; phone?: unknown; pickupStore?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的出貨申請資料。" }, { status: 400 });
  }

  const recipientName = typeof body.recipientName === "string" ? body.recipientName.trim().slice(0, 80) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const pickupStore = typeof body.pickupStore === "string" ? body.pickupStore.trim().slice(0, 120) : "";
  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];

  if (!recipientName || !phone || !pickupStore || !orderIds.length) {
    return NextResponse.json({ ok: false, error: "請確認出貨申請資料是否正確。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("submit_community_shipment_request", {
      p_nickname: binding.nickname,
      p_order_ids: orderIds,
      p_recipient_name: recipientName,
      p_phone: phone,
      p_pickup_store: pickupStore,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, result: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json({ ok: false, error: friendlyError(message) }, { status: 500 });
  }
}

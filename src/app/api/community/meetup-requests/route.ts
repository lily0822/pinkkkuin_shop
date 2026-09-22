import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCommunityLineBinding } from "@/lib/community-line-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientKey(request: NextRequest) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

async function limited(request: NextRequest) {
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("backend_hit_rate_limit", { p_scope: "public_community_meetup", p_bucket_key: clientKey(request), p_limit: 20, p_window_seconds: 60 });
    if (error) return false;
    const row = Array.isArray(data) ? data[0] : data;
    return !row?.allowed;
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  const binding = await getCommunityLineBinding(request);
  if (!binding) return NextResponse.json({ ok: false, error: "請先使用 LINE 登入並綁定社群暱稱。" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data, error } = await supabase.from("community_meetup_slots").select("id,meetup_date,start_time,end_time,location").eq("is_open", true).gte("meetup_date", today).order("meetup_date").order("start_time");
  if (error) return NextResponse.json({ ok: false, error: "面交時段讀取失敗。" }, { status: 500 });
  const now = Date.now();
  const slots = (data || []).filter((row) => new Date(`${row.meetup_date}T${row.end_time}+08:00`).getTime() > now).map((row) => ({ id: row.id, date: row.meetup_date, startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), location: row.location }));
  return NextResponse.json({ ok: true, slots });
}

export async function POST(request: NextRequest) {
  const binding = await getCommunityLineBinding(request);
  if (!binding) return NextResponse.json({ ok: false, error: "請先使用 LINE 登入並綁定社群暱稱。" }, { status: 401 });
  if (await limited(request)) return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  const body = await request.json().catch(() => null) as { orderIds?: unknown; slotId?: unknown; paymentMethod?: unknown } | null;
  const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)) : [];
  const slotId = typeof body?.slotId === "string" && UUID_RE.test(body.slotId) ? body.slotId : "";
  const paymentMethod = body?.paymentMethod === "prepaid" || body?.paymentMethod === "pay_at_meetup" ? body.paymentMethod : "";
  if (!orderIds.length || !slotId || !paymentMethod) return NextResponse.json({ ok: false, error: "請選擇記事本、時段與付款方式。" }, { status: 400 });
  const { data, error } = await createSupabaseServiceClient().rpc("submit_community_meetup_request", { p_nickname: binding.nickname, p_order_ids: orderIds, p_slot_id: slotId, p_payment_method: paymentMethod });
  if (error) {
    const raw = error.message || "";
    const message = raw.includes("not_all_arrived") ? "所選記事本尚未全部到貨。" : raw.includes("fulfillment_already_requested") ? "所選記事本已有出貨或面交申請。" : raw.includes("slot_") ? "這個面交時段已關閉或過期。" : "面交預約送出失敗。";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  return NextResponse.json({ ok: true, result: data });
}

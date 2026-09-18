import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
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
      p_scope: "public_community_remittance_submit",
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
const LAST5_RE = /^[0-9]{5}$/;

export async function POST(request: NextRequest) {
  if (await rateLimited(request)) {
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試。" }, { status: 429 });
  }

  let body: { nickname?: unknown; orderIds?: unknown; bank?: unknown; accountLast5?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的匯款資料。" }, { status: 400 });
  }

  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 120) : "";
  const bank = typeof body.bank === "string" ? body.bank.trim().slice(0, 60) : "";
  const accountLast5 = typeof body.accountLast5 === "string" ? body.accountLast5.trim() : "";
  const amount = Number(body.amount);
  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];

  if (!nickname || !bank || !LAST5_RE.test(accountLast5) || !orderIds.length || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "請確認匯款資料是否正確。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("submit_community_remittance", {
      p_nickname: nickname,
      p_order_ids: orderIds,
      p_bank: bank,
      p_account_last5: accountLast5,
      p_amount: amount,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ ok: false, error: "送出失敗，請稍後再試。" }, { status: 500 });
  }
}

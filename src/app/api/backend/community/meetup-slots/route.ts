import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { backendAuthJsonError, getBackendRuntime, isBackendSessionValid, isSameOriginMutation, shouldRequireBackendAuth } from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function guard(request: NextRequest, mutation = false) {
  if (getBackendRuntime() === "unknown") return new NextResponse("Not found", { status: 404 });
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

function mapSlot(row: Record<string, unknown>) {
  return { id: String(row.id || ""), date: String(row.meetup_date || ""), startTime: String(row.start_time || "").slice(0, 5), endTime: String(row.end_time || "").slice(0, 5), location: String(row.location || ""), isOpen: Boolean(row.is_open) };
}

export async function GET(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("community_meetup_slots").select("id,meetup_date,start_time,end_time,location,is_open").order("meetup_date").order("start_time");
  if (error) return NextResponse.json({ ok: false, error: "面交時段讀取失敗。" }, { status: 500 });
  return NextResponse.json({ ok: true, slots: (data || []).map((row) => mapSlot(row as Record<string, unknown>)) });
}

export async function POST(request: NextRequest) {
  const denied = await guard(request, true); if (denied) return denied;
  const rate = await backendRateLimit(request, "backend_community_meetup_slots_create", 40); if (!rate.ok) return NextResponse.json({ ok: false, error: "操作太頻繁。" }, { status: 429 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const startTime = typeof body?.startTime === "string" ? body.startTime.trim() : "";
  const endTime = typeof body?.endTime === "string" ? body.endTime.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim().slice(0, 200) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || !location || endTime <= startTime) return NextResponse.json({ ok: false, error: "請確認日期、時間與地點。" }, { status: 400 });
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("community_meetup_slots").insert({ meetup_date: date, start_time: startTime, end_time: endTime, location, is_open: body?.isOpen !== false }).select("id,meetup_date,start_time,end_time,location,is_open").single();
  if (error) return NextResponse.json({ ok: false, error: "面交時段建立失敗。" }, { status: 500 });
  return NextResponse.json({ ok: true, slot: mapSlot(data as Record<string, unknown>) });
}

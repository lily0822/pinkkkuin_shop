import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { backendAuthJsonError, getBackendRuntime, isBackendSessionValid, shouldRequireBackendAuth } from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (getBackendRuntime() === "unknown") return new NextResponse("Not found", { status: 404 });
  if (shouldRequireBackendAuth() && !(await isBackendSessionValid(request))) return backendAuthJsonError();
  const { data, error } = await createSupabaseServiceClient().rpc("backend_list_community_meetup_requests", { p_limit: 200 });
  if (error) return NextResponse.json({ ok: false, error: "面交預約讀取失敗。" }, { status: 500 });
  return NextResponse.json({ ok: true, requests: data || [] });
}

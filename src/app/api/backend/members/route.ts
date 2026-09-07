import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit, writeBackendSecurityAuditLog } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["active", "disabled"]);
const ALLOWED_LINE_FILTERS = new Set(["all", "linked", "unlinked"]);
const ALLOWED_PAGE_SIZES = new Set([10, 20, 50]);

async function guardBackendRequest(request: NextRequest, mutation = false) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

async function rateLimitResponse(request: NextRequest, scope: string, limit = 80) {
  const rate = await backendRateLimit(request, scope, limit);
  if (rate.ok) return null;
  return NextResponse.json(
    { ok: false, error: "操作太頻繁，請稍後再試。" },
    { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
  );
}

function cleanText(value: string | null) {
  return (value || "").trim();
}

function cleanPage(value: string | null) {
  const page = Number.parseInt(value || "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function cleanPageSize(value: string | null) {
  const size = Number.parseInt(value || "", 10);
  return ALLOWED_PAGE_SIZES.has(size) ? size : 20;
}

function cleanStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ALLOWED_STATUSES.has(status) ? status : "";
}

function maskPhone(value: unknown) {
  const phone = typeof value === "string" ? value.trim() : "";
  if (!phone) return "";
  if (phone.length <= 4) return "****";
  return `${phone.slice(0, 2)}****${phone.slice(-2)}`;
}

function mapMember(row: Record<string, unknown>) {
  return {
    userId: String(row.user_id || ""),
    createdAt: String(row.created_at || ""),
    email: String(row.email || ""),
    emailVerified: Boolean(row.email_verified),
    displayName: String(row.display_name || ""),
    phoneMasked: maskPhone(row.phone),
    status: String(row.status || "active"),
    lineLinked: Boolean(row.line_linked),
    lineLinkedAt: row.line_linked_at ? String(row.line_linked_at) : "",
    orderCount: Number(row.order_count || 0),
    lastOrderAt: row.last_order_at ? String(row.last_order_at) : "",
  };
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;
  const rateLimit = await rateLimitResponse(request, "backend_members_list", 90);
  if (rateLimit) return rateLimit;

  const incoming = new URL(request.url);
  const q = cleanText(incoming.searchParams.get("q")).slice(0, 120);
  const rawLineStatus = cleanText(incoming.searchParams.get("line")).toLowerCase();
  const rawStatus = cleanText(incoming.searchParams.get("status")).toLowerCase();
  const lineStatus = ALLOWED_LINE_FILTERS.has(rawLineStatus) ? rawLineStatus : "all";
  const status = ALLOWED_STATUSES.has(rawStatus) ? rawStatus : "all";
  const page = cleanPage(incoming.searchParams.get("page"));
  const pageSize = cleanPageSize(incoming.searchParams.get("page_size"));

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("backend_list_members", {
      p_q: q,
      p_line_status: lineStatus,
      p_status: status,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const total = Number(rows[0]?.total_count || 0);
    return NextResponse.json({
      ok: true,
      members: rows.map((row) => mapMember(row as Record<string, unknown>)),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total > 0 ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "會員列表讀取失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;
  const rateLimit = await rateLimitResponse(request, "backend_members_status", 30);
  if (rateLimit) return rateLimit;

  let body: { userId?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的會員狀態。" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const status = cleanStatus(body.status);
  if (!userId || !status) {
    return NextResponse.json({ ok: false, error: "請提供正確的會員狀態。" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("member_profiles")
      .upsert({ user_id: userId, status }, { onConflict: "user_id" });
    if (error) throw error;

    await writeBackendSecurityAuditLog(
      request,
      status === "disabled" ? "member_disable" : "member_reenable",
      userId,
      { status },
    );

    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json(
      { ok: false, error: "會員狀態更新失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}

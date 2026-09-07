import { NextRequest, NextResponse } from "next/server";
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function callMemberDetailRpc(userId: string) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, status: 500, data: null };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/backend_get_member_detail`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_user_id: userId }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function maskPhone(value: unknown) {
  const phone = typeof value === "string" ? value.trim() : "";
  if (!phone) return "";
  if (phone.length <= 4) return "****";
  return `${phone.slice(0, 2)}****${phone.slice(-2)}`;
}

function maskAddress(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length <= 6) return "******";
  return `${text.slice(0, 3)}******${text.slice(-3)}`;
}

function maskDetail(detail: Record<string, unknown>, reveal: boolean) {
  const profile = (detail.profile || {}) as Record<string, unknown>;
  const addresses = Array.isArray(detail.addresses) ? detail.addresses : [];
  return {
    ...detail,
    profile: {
      ...profile,
      phone: reveal ? String(profile.phone || "") : maskPhone(profile.phone),
    },
    addresses: addresses.map((address) => {
      const row = address as Record<string, unknown>;
      return {
        ...row,
        phone: reveal ? String(row.phone || "") : maskPhone(row.phone),
        addressLine: reveal ? String(row.addressLine || "") : maskAddress(row.addressLine),
      };
    }),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const { id } = await context.params;
  const userId = String(id || "").trim();
  if (!isUuid(userId)) {
    return NextResponse.json({ ok: false, error: "找不到會員資料。" }, { status: 404 });
  }

  const reveal = new URL(request.url).searchParams.get("reveal") === "1";
  const rateLimit = await rateLimitResponse(
    request,
    reveal ? "backend_members_reveal" : "backend_members_detail",
    reveal ? 20 : 90,
  );
  if (rateLimit) return rateLimit;

  try {
    const { ok, status, data } = await callMemberDetailRpc(userId);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "會員資料讀取失敗，請稍後再試。" },
        { status: status >= 500 ? 500 : 400 },
      );
    }
    if (!data) return NextResponse.json({ ok: false, error: "找不到會員資料。" }, { status: 404 });

    if (reveal) {
      await writeBackendSecurityAuditLog(request, "member_pii_reveal", userId, {
        fields: ["profile.phone", "addresses.phone", "addresses.address_line"],
      });
    }

    return NextResponse.json({
      ok: true,
      member: maskDetail(data as Record<string, unknown>, reveal),
      piiRevealed: reveal,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "會員資料讀取失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}

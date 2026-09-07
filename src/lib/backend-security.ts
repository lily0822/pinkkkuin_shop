import "server-only";

import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { BACKEND_SESSION_COOKIE } from "@/lib/backend-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const session = request.cookies.get(BACKEND_SESSION_COOKIE)?.value || "";
  return hashValue(`${ip}:${session.slice(-32)}`);
}

export async function backendRateLimit(
  request: NextRequest,
  scope: string,
  limit = 80,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("backend_hit_rate_limit", {
    p_scope: scope,
    p_bucket_key: clientKey(request),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return { ok: false, retryAfterSeconds: 60 };

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: Boolean(row?.allowed),
    retryAfterSeconds: Math.max(0, Number(row?.retry_after_seconds || 0)),
  };
}

export function backendSessionIdentifier(request: NextRequest) {
  const token = request.cookies.get(BACKEND_SESSION_COOKIE)?.value || "";
  if (!token) return "";
  return hashValue(token).slice(0, 24);
}

export async function writeBackendSecurityAuditLog(
  request: NextRequest,
  action: "member_pii_reveal" | "member_disable" | "member_reenable",
  targetUserId: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("backend_security_audit_logs").insert({
      action,
      target_user_id: targetUserId,
      admin_session_id: backendSessionIdentifier(request) || null,
      metadata,
    });
  } catch {
    // Audit logging must not leak details to logs or expose PII, but protected actions should fail closed.
    throw new Error("audit_log_failed");
  }
}

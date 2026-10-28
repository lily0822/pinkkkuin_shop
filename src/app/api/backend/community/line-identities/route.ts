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
import { submitLiveIdentity } from "@/lib/line/live-identity-rpc";
import { validateLiveBindingValue, type LiveBindingType } from "@/lib/line/live-identity-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_LIMIT = 5000;

async function guardBackendRequest(request: NextRequest, mutation = false) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  if (mutation && !isSameOriginMutation(request)) return backendAuthJsonError("請從後台頁面操作。", 403);
  return null;
}

type IdentityRow = {
  id: string;
  line_user_id: string;
  line_display_name: string | null;
  binding_type: string;
  binding_value: string;
  created_at: string;
  updated_at: string;
};

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_identities_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const incoming = new URL(request.url);
  const q = (incoming.searchParams.get("q") || "").trim().toLocaleLowerCase().slice(0, 120);

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: identityData, error: identityError }, { data: logData, error: logError }] = await Promise.all([
      supabase
        .from("community_line_identities")
        .select("id, line_user_id, line_display_name, binding_type, binding_value, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
      supabase
        .from("community_line_identity_logs")
        .select("line_user_id, action")
        .in("action", ["edit", "admin_edit"])
        .limit(FETCH_LIMIT),
    ]);
    if (identityError) throw identityError;
    if (logError) throw logError;

    const identities = (identityData as IdentityRow[] | null) || [];
    const editCounts = new Map<string, number>();
    ((logData as { line_user_id: string }[] | null) || []).forEach((row) => {
      editCounts.set(row.line_user_id, (editCounts.get(row.line_user_id) || 0) + 1);
    });

    let customers = identities.map((row) => ({
      lineUserId: row.line_user_id,
      lineDisplayName: row.line_display_name || "LINE 使用者",
      type: row.binding_type as LiveBindingType,
      value: row.binding_value,
      boundAt: row.created_at,
      updatedAt: row.updated_at,
      editCount: editCounts.get(row.line_user_id) || 0,
    }));

    if (q) {
      customers = customers.filter(
        (c) => c.value.toLocaleLowerCase().includes(q) || c.lineDisplayName.toLocaleLowerCase().includes(q),
      );
    }

    const stats = {
      total: identities.length,
      nickname: identities.filter((row) => row.binding_type === "nickname").length,
      ig: identities.filter((row) => row.binding_type === "ig").length,
    };

    return NextResponse.json({ ok: true, stats, customers });
  } catch {
    return NextResponse.json({ ok: false, error: "社群綁定資料讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

type AdminBindBody = {
  lineUserId?: unknown;
  lineDisplayName?: unknown;
  type?: unknown;
  value?: unknown;
};

// 後台「編輯」既有綁定跟「幫他綁定」共用這支路由——actor 一律是
// 'admin'，RPC 本身會依照這個 line_user_id 目前有沒有綁定自動判斷要
// bind 還是 edit（寫進紀錄的 action 也會自動對應 admin_bind/admin_edit），
// 後台不用自己先查一次再決定要打哪一支 API。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_identities_write", 30);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: AdminBindBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const lineUserId = typeof body.lineUserId === "string" ? body.lineUserId.trim() : "";
  if (!lineUserId) return NextResponse.json({ ok: false, error: "缺少客人的 LINE 帳號。" }, { status: 400 });

  const type = body.type === "ig" ? "ig" : body.type === "nickname" ? "nickname" : null;
  if (!type) return NextResponse.json({ ok: false, error: "請選擇綁定類型。" }, { status: 400 });

  const rawValue = typeof body.value === "string" ? body.value : "";
  const validation = validateLiveBindingValue(type, rawValue);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.message }, { status: 400 });
  }

  const lineDisplayName = typeof body.lineDisplayName === "string" ? body.lineDisplayName.trim() || null : null;

  const result = await submitLiveIdentity({
    lineUserId,
    lineDisplayName,
    bindingType: type,
    bindingValue: validation.value,
    actor: "admin",
  });

  if (!result.ok) {
    if (result.error === "conflict") {
      return NextResponse.json(
        { ok: false, error: type === "ig" ? "這個 IG 帳號已經有人綁定了。" : "這個暱稱已經有人綁定了。" },
        { status: 409 },
      );
    }
    if (result.error === "unchanged") {
      return NextResponse.json({ ok: false, error: "這跟目前的綁定一樣，沒有需要修改的地方。" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "儲存失敗，請稍後再試一次。" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    identity: { type: result.identity.bindingType, value: result.identity.bindingValue },
  });
}

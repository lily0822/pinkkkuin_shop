import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_LIMIT = 500;

async function guardBackendRequest(request: NextRequest) {
  if (getBackendRuntime() === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!shouldRequireBackendAuth()) return null;
  if (!(await isBackendSessionValid(request))) return backendAuthJsonError();
  return null;
}

type LogRow = {
  id: string;
  line_user_id: string;
  line_display_name: string | null;
  action: string;
  old_type: string | null;
  old_value: string | null;
  new_type: string | null;
  new_value: string | null;
  created_at: string;
};

function formatValue(type: string | null, value: string | null) {
  if (!value) return "";
  return type === "ig" ? `IG「${value}」` : `社群暱稱「${value}」`;
}

// 時間線文字在這裡（後端）組好一次送出去，不要讓後台 HTML 自己拼接
// action/old/new 欄位——這些組合規則只有一份，之後要調整措辭只改這裡。
function describeLog(row: LogRow): string {
  switch (row.action) {
    case "bind":
      return `綁定 ${formatValue(row.new_type, row.new_value)}`;
    case "admin_bind":
      return `賣家代綁 ${formatValue(row.new_type, row.new_value)}`;
    case "edit":
      return `修改：${formatValue(row.old_type, row.old_value)} → ${formatValue(row.new_type, row.new_value)}`;
    case "admin_edit":
      return `賣家修改：${formatValue(row.old_type, row.old_value)} → ${formatValue(row.new_type, row.new_value)}`;
    case "blocked":
      return `被擋下：想綁定 ${formatValue(row.new_type, row.new_value)}，已被別人使用`;
    case "unbind":
      return `解除綁定：${formatValue(row.old_type, row.old_value)}`;
    default:
      return row.action;
  }
}

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_line_identity_logs_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("community_line_identity_logs")
      .select("id, line_user_id, line_display_name, action, old_type, old_value, new_type, new_value, created_at")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw error;

    const rows = (data as LogRow[] | null) || [];
    const logs = rows.map((row) => ({
      id: row.id,
      lineDisplayName: row.line_display_name || "LINE 使用者",
      action: row.action,
      text: describeLog(row),
      createdAt: row.created_at,
    }));

    return NextResponse.json({ ok: true, logs });
  } catch {
    return NextResponse.json({ ok: false, error: "綁定紀錄讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

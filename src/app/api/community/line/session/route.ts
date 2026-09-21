import { NextRequest, NextResponse } from "next/server";
import { getCommunityLineSession } from "@/lib/community-line-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const session = getCommunityLineSession(request);
  if (!session) return NextResponse.json({ ok: true, authenticated: false, binding: null });

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("community_line_bindings")
      .select("nickname,updated_at")
      .eq("line_user_id", session.lineUserId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      authenticated: true,
      displayName: session.displayName,
      binding: data ? { nickname: String(data.nickname || ""), updatedAt: String(data.updated_at || "") } : null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "LINE 綁定資料讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = getCommunityLineSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "請先使用 LINE 登入。" }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "無法驗證操作來源。" }, { status: 403 });

  let body: { nickname?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請輸入正確的社群暱稱。" }, { status: 400 });
  }
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 120) : "";
  if (!nickname) return NextResponse.json({ ok: false, error: "請輸入社群暱稱。" }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const { data: orders, error: lookupError } = await service.rpc("lookup_community_orders_by_nickname", {
      p_nickname: nickname,
    });
    if (lookupError) throw lookupError;
    const rows = Array.isArray(orders) ? orders : [];
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "找不到這個社群暱稱，請確認後再試。" }, { status: 404 });
    }
    const canonicalNickname = String((rows[0] as Record<string, unknown>).nickname || nickname).trim();
    const { error } = await service.from("community_line_bindings").upsert(
      {
        line_user_id: session.lineUserId,
        line_display_name: session.displayName || null,
        nickname: canonicalNickname,
      },
      { onConflict: "line_user_id" },
    );
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ ok: false, error: "這個社群暱稱已綁定其他 LINE 帳號。" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, binding: { nickname: canonicalNickname } });
  } catch {
    return NextResponse.json({ ok: false, error: "綁定失敗，請稍後再試。" }, { status: 500 });
  }
}

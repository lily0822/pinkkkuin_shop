import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentSession } from "@/lib/line/livestream-sessions";
import { getLineUserBindingLabel } from "@/lib/line/live-bindings";
import { getOrderRequiresBindSetting } from "@/lib/line/livestream-order-gate-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 完成畫面當下就渲染，不需要像 LINE Flex 那樣留 7 天

type SubmitItemInput = { id?: unknown; quantity?: unknown; unitPrice?: unknown; category?: unknown };

// 分類值只能是 general/gacha，其他一律當 general——不讓整筆送出失敗。
function sanitizeCategory(value: unknown): "general" | "gacha" {
  return value === "gacha" ? "gacha" : "general";
}

function sanitizeItems(input: unknown): { id: string; quantity: number; unit_price: number; category: "general" | "gacha" }[] {
  if (!Array.isArray(input)) return [];
  const result: { id: string; quantity: number; unit_price: number; category: "general" | "gacha" }[] = [];
  for (const raw of input as SubmitItemInput[]) {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const quantity = Math.floor(Number(raw.quantity));
    const unitPrice = Math.floor(Number(raw.unitPrice));
    // 伺服器端重新驗證範圍——不信任前端傳來的任何東西，除了 id 以外的
    // 欄位都要重新檢查型別/範圍。
    if (!id || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) continue;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    result.push({ id, quantity, unit_price: unitPrice, category: sanitizeCategory(raw.category) });
  }
  return result;
}

function sanitizeRemoveIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export async function POST(request: NextRequest) {
  let body: { token?: unknown; items?: unknown; removeIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyLivestreamMagicLink(token, "order-confirm");
  if (!payload) {
    return NextResponse.json({ ok: false, error: "連結已過期，請回到 LINE 重新按「傳好了」。" }, { status: 401 });
  }

  const items = sanitizeItems(body.items);
  const removeIds = sanitizeRemoveIds(body.removeIds);
  if (!items.length && !removeIds.length) {
    return NextResponse.json({ ok: false, error: "請至少確認一樣商品。" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // 場次一定是呼叫當下重新判斷，不信任前端傳來的任何場次資訊——客人
  // 填單價可能花超過場次剩餘的時間，場次可能在這段時間內結束。
  const session = await getCurrentSession(supabase);
  if (!session) {
    return NextResponse.json({ ok: false, error: "session_not_active" }, { status: 400 });
  }

  // 伺服器端把關：前端的「下單前必須先綁定」只是體驗引導（客人正常
  // 不會走到這裡還沒綁定），真正擋住未綁定客人送出訂單的是這裡——不
  // 信任前端已經檢查過。只在後台開關開啟時生效。
  if (await getOrderRequiresBindSetting()) {
    const binding = await getLineUserBindingLabel(payload.lineUserId);
    if (!binding) {
      return NextResponse.json({ ok: false, error: "requires_bind" }, { status: 403 });
    }
  }

  const { data, error } = await supabase.rpc("submit_livestream_order", {
    p_line_user_id: payload.lineUserId,
    p_session_id: session.id,
    p_items: items.map((item) => ({ id: item.id, quantity: item.quantity, unit_price: item.unit_price, category: item.category })),
    p_remove_ids: removeIds,
  });

  if (error) {
    if (error.message?.includes("session_not_active")) {
      return NextResponse.json({ ok: false, error: "session_not_active" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "送出失敗，請稍後再試一次。" }, { status: 500 });
  }

  type SubmittedRow = {
    id: string;
    product_name: string | null;
    quantity: number;
    customer_unit_price: number | null;
    photo_storage_path: string | null;
  };
  const rows = (data as SubmittedRow[] | null) || [];

  const responseItems = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      productName: row.product_name,
      quantity: row.quantity,
      unitPrice: Number(row.customer_unit_price || 0),
      photoUrl: row.photo_storage_path
        ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, SIGNED_URL_TTL_SECONDS)
        : null,
    })),
  );

  return NextResponse.json({ ok: true, items: responseItems, sessionName: session.name });
}

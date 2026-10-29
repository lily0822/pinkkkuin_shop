import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemInput = { id?: unknown; quantity?: unknown };

function sanitizeQuantityItems(input: unknown): { id: string; quantity: number }[] {
  if (!Array.isArray(input)) return [];
  const result: { id: string; quantity: number }[] = [];
  for (const raw of input as ItemInput[]) {
    const item = raw as ItemInput;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const quantity = Math.floor(Number(item.quantity));
    if (!id || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) continue;
    result.push({ id, quantity });
  }
  return result;
}

function sanitizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export async function POST(request: NextRequest) {
  let body: { token?: unknown; items?: unknown; cancelIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的資料。" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyLivestreamMagicLink(token, "order-edit");
  if (!payload) {
    return NextResponse.json({ ok: false, error: "連結已過期，請回到 LINE 重新按「查詢訂單」。" }, { status: 401 });
  }

  const quantityChanges = sanitizeQuantityItems(body.items);
  const cancelIds = sanitizeIds(body.cancelIds);
  if (!quantityChanges.length && !cancelIds.length) {
    return NextResponse.json({ ok: false, error: "沒有要儲存的修改。" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // 每筆各自用 guarded update 當成單一 UPDATE...WHERE...RETURNING——
  // line_user_id 確保只能動自己的訂單，order_status='submitted' +
  // purchased_quantity 為空且 paid_amount=0 確保「已採買/已匯款的訂單
  // 不可修改/取消」這條規則在資料庫層面自動生效，不需要額外的 RPC
  // （每筆修改互相獨立，不像送出訂單時需要跨列配商品編號）。沒有回傳列
  // 代表這筆現在已經不符合條件（剛好被標記採買、或已經被取消過）。
  // 階段二（結算模型）起鎖定條件從「remittance_id is null」改成
  // 「paid_amount=0」——新模型下同一筆訂單可能已經匯過款又被補款多次，
  // remittance_id 只代表「曾經匯過款」這個單一標記，不再能可靠判斷
  // 「現在是不是已經付了錢」。
  const results: { id: string; action: "quantity" | "cancel"; success: boolean }[] = [];

  for (const change of quantityChanges) {
    const { data } = await supabase
      .from("community_livestream_orders")
      .update({ quantity: change.quantity })
      .eq("id", change.id)
      .eq("line_user_id", payload.lineUserId)
      .eq("order_status", "submitted")
      .is("purchased_quantity", null)
      .eq("paid_amount", 0)
      .select("id");
    results.push({ id: change.id, action: "quantity", success: Boolean(data && data.length) });
  }

  for (const id of cancelIds) {
    const { data } = await supabase
      .from("community_livestream_orders")
      .update({ order_status: "cancelled" })
      .eq("id", id)
      .eq("line_user_id", payload.lineUserId)
      .eq("order_status", "submitted")
      .is("purchased_quantity", null)
      .eq("paid_amount", 0)
      .select("id");
    results.push({ id, action: "cancel", success: Boolean(data && data.length) });
  }

  return NextResponse.json({ ok: true, results });
}

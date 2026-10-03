import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // admin-view thumbnail only, short-lived
const PURCHASE_STATUSES = new Set(["not_bought", "bought"]);
const PAYMENT_STATUSES = new Set(["unpaid", "confirming", "paid"]);

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

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_orders_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const incoming = new URL(request.url);
  const q = (incoming.searchParams.get("q") || "").trim().toLocaleLowerCase().slice(0, 120);
  const purchaseStatus = (incoming.searchParams.get("purchaseStatus") || "").trim();
  const paymentStatus = (incoming.searchParams.get("paymentStatus") || "").trim();
  const unrecognizedOnly = incoming.searchParams.get("unrecognizedOnly") === "1";
  const priceDisputedOnly = incoming.searchParams.get("priceDisputedOnly") === "1";

  try {
    const supabase = createSupabaseServiceClient();
    let query = supabase
      .from("community_livestream_orders")
      .select(
        "id, line_user_id, line_display_name, nickname, product_name, unit_price, total_price, quantity, recognized_confidence, purchase_status, payment_status, notes, photo_storage_path, price_disputed_at, price_dispute_suggested_price, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (PURCHASE_STATUSES.has(purchaseStatus)) query = query.eq("purchase_status", purchaseStatus);
    if (PAYMENT_STATUSES.has(paymentStatus)) query = query.eq("payment_status", paymentStatus);
    if (unrecognizedOnly) query = query.is("unit_price", null);
    if (priceDisputedOnly) query = query.not("price_disputed_at", "is", null);

    const { data, error } = await query;
    if (error) throw error;

    // Keyword search happens in JS, not via a raw ilike-OR filter string —
    // this table has no dedicated search RPC (unlike community_orders'
    // backend_list_community_* functions) and building a safely-escaped
    // multi-column OR filter from free-text input is easy to get wrong;
    // filtering an already status-filtered, capped (500-row) result set
    // in memory is simple and has no injection surface at all.
    const allRows = Array.isArray(data) ? data : [];
    const rows = q
      ? allRows.filter((row) => {
          const haystack = `${row.nickname || ""} ${row.line_display_name || ""} ${row.product_name || ""}`.toLocaleLowerCase();
          return haystack.includes(q);
        })
      : allRows;

    const photoUrls = await Promise.all(
      rows.map((row) =>
        row.photo_storage_path ? createSignedUrl(PHOTO_BUCKET, String(row.photo_storage_path), SIGNED_URL_TTL_SECONDS) : Promise.resolve(null),
      ),
    );

    // 功能五 (自助匯款申報)：payment_status='confirming' 的訂單，反查最新一筆
    // 涵蓋該訂單 id 的申報記錄，秀出客人回報的銀行/後 5 碼/申報金額給
    // 管理員核對。一次查、記憶體比對，避免對每一筆 confirming 訂單各打
    // 一次查詢。amount 現在可能是 null（客人沒填成功、或舊資料），
    // 轉換時要跟 remittance 本身是否存在分開判斷，不能直接 Number(null)
    // 當成 0。
    const confirmingUserIds = [
      ...new Set(rows.filter((row) => row.payment_status === "confirming" && row.line_user_id).map((row) => String(row.line_user_id))),
    ];
    let remittances: {
      order_ids: string[];
      bank_name: string | null;
      account_last5: string;
      amount: number | null;
      submitted_at: string;
    }[] = [];
    if (confirmingUserIds.length) {
      const { data: remittanceData } = await supabase
        .from("community_livestream_remittances")
        .select("order_ids, bank_name, account_last5, amount, submitted_at")
        .in("line_user_id", confirmingUserIds)
        .order("submitted_at", { ascending: false })
        .limit(500);
      remittances = Array.isArray(remittanceData) ? remittanceData : [];
    }
    function findLatestRemittance(orderId: string) {
      return remittances.find((remittance) => Array.isArray(remittance.order_ids) && remittance.order_ids.includes(orderId)) || null;
    }

    return NextResponse.json({
      ok: true,
      orders: rows.map((row, index) => {
        const remittance = row.payment_status === "confirming" ? findLatestRemittance(String(row.id)) : null;
        return {
          id: String(row.id || ""),
          lineUserId: String(row.line_user_id || ""),
          lineDisplayName: String(row.line_display_name || ""),
          nickname: String(row.nickname || ""),
          productName: row.product_name ? String(row.product_name) : "",
          unitPrice: row.unit_price === null || row.unit_price === undefined ? null : Number(row.unit_price),
          totalPrice: row.total_price === null || row.total_price === undefined ? null : Number(row.total_price),
          quantity: Number(row.quantity || 1),
          confidence:
            row.recognized_confidence === null || row.recognized_confidence === undefined ? null : Number(row.recognized_confidence),
          purchaseStatus: String(row.purchase_status || "not_bought"),
          paymentStatus: String(row.payment_status || "unpaid"),
          notes: String(row.notes || ""),
          photoUrl: photoUrls[index],
          remittanceBankName: remittance?.bank_name || null,
          remittanceLast5: remittance?.account_last5 || null,
          remittanceAmount: remittance && remittance.amount !== null ? Number(remittance.amount) : null,
          priceDisputedAt: row.price_disputed_at ? String(row.price_disputed_at) : null,
          priceDisputeSuggestedPrice:
            row.price_dispute_suggested_price === null || row.price_dispute_suggested_price === undefined
              ? null
              : Number(row.price_dispute_suggested_price),
          createdAt: String(row.created_at || ""),
          updatedAt: String(row.updated_at || ""),
        };
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "社群連線訂單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

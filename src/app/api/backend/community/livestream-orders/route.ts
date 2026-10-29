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
import { getCurrentOrMostRecentSession } from "@/lib/line/livestream-sessions";
import {
  effectiveLivestreamUnitPrice,
  effectiveLivestreamQuantity,
  computeLivestreamSettlement,
} from "@/lib/line/livestream-pricing";
import { getLineUserBindingLabelsBatch } from "@/lib/line/live-bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // admin-view thumbnail only, short-lived
const PURCHASE_STATUSES = new Set(["not_bought", "bought"]);
const PAYMENT_STATUSES = new Set(["unpaid", "confirming", "paid"]);
const PRODUCT_CATEGORIES = new Set(["general", "gacha"]);

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
  const productCategory = (incoming.searchParams.get("productCategory") || "").trim();
  const unrecognizedOnly = incoming.searchParams.get("unrecognizedOnly") === "1";
  const priceDisputedOnly = incoming.searchParams.get("priceDisputedOnly") === "1";
  // 階段二（結算模型）新增的兩個快篩，跟 unrecognizedOnly 一樣在記憶體裡
  // 篩（owed/refundDue 是算出來的，不是資料庫欄位，沒辦法直接下在
  // Supabase query builder 上）。
  const needsTopupOnly = incoming.searchParams.get("needsTopupOnly") === "1";
  const hasRefundDueOnly = incoming.searchParams.get("hasRefundDueOnly") === "1";
  // 連線代購下單改版：場次篩選——"unassigned" 對應舊資料（session_id is
  // null）；沒帶這個參數時，用「當下連線／最近一場」當預設值（見
  // getCurrentOrMostRecentSession），維持跟後台「連線場次」下拉選單的
  // 預設選項一致。
  const sessionIdParam = incoming.searchParams.get("sessionId");

  try {
    const supabase = createSupabaseServiceClient();

    let appliedSessionId: string | null = null;
    let appliedSessionName: string | null = null;
    if (sessionIdParam === "unassigned") {
      appliedSessionId = null;
    } else if (sessionIdParam) {
      appliedSessionId = sessionIdParam;
    } else {
      const defaultSession = await getCurrentOrMostRecentSession(supabase);
      appliedSessionId = defaultSession?.id || null;
      appliedSessionName = defaultSession?.name || null;
    }

    let query = supabase
      .from("community_livestream_orders")
      .select(
        "id, line_user_id, line_display_name, nickname, product_name, unit_price, customer_unit_price, seller_unit_price, purchased_quantity, remittance_id, total_price, quantity, recognized_confidence, purchase_status, payment_status, notes, photo_storage_path, price_disputed_at, price_dispute_suggested_price, paid_amount, refunded_at, refunded_amount, product_category, created_at, updated_at",
      )
      // staged（客人還沒送出的暫存照片）跟 cancelled 永遠不出現在任何
      // 後台列表——這次改版新增的中間狀態，既有的訂單管理畫面本來就不
      // 是為了顯示「還沒確定的東西」設計的。
      .eq("order_status", "submitted")
      .order("created_at", { ascending: false })
      .limit(500);

    if (sessionIdParam === "unassigned") {
      query = query.is("session_id", null);
    } else if (appliedSessionId) {
      query = query.eq("session_id", appliedSessionId);
    }

    if (PURCHASE_STATUSES.has(purchaseStatus)) query = query.eq("purchase_status", purchaseStatus);
    if (PAYMENT_STATUSES.has(paymentStatus)) query = query.eq("payment_status", paymentStatus);
    if (PRODUCT_CATEGORIES.has(productCategory)) query = query.eq("product_category", productCategory);
    // 連線代購下單改版 第二階段：新流程的訂單一律有 customer_unit_price
    // （確認頁必填），unit_price 永遠是 null——這個「無法辨識價格」快篩
    // 現在只該命中三個欄位都是 null 的真正舊資料，不能只看 unit_price。
    // 第三階段新增 seller_unit_price 後，三個都要一起檢查。
    if (unrecognizedOnly) query = query.is("unit_price", null).is("customer_unit_price", null).is("seller_unit_price", null);
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

    // 社群綁定功能：批次查一次這批訂單涵蓋的全部客人的綁定標籤，不要
    // 每筆訂單各查一次。同時讓搜尋框可以搜到暱稱/IG（不只是 LINE 名稱/
    // 社群記事本舊暱稱/商品名）。
    const bindingsByUser = await getLineUserBindingLabelsBatch(
      allRows.map((row) => String(row.line_user_id || "")).filter(Boolean),
    );

    // 階段二（結算模型）：每一列先算好 owed/refundDue，給下面的快篩跟
    // 最終回應共用，不要算兩次。
    const settlementById = new Map(
      allRows.map((row) => {
        const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
        const settlement = computeLivestreamSettlement({
          effectiveUnitPrice,
          quantity: Number(row.quantity || 1),
          purchasedQuantity: row.purchased_quantity,
          paidAmount: Number(row.paid_amount || 0),
          refundedAt: row.refunded_at,
          refundedAmount: row.refunded_amount,
        });
        return [String(row.id), settlement] as const;
      }),
    );

    const rows = allRows.filter((row) => {
      if (q) {
        const binding = bindingsByUser.get(String(row.line_user_id || ""));
        const haystack = `${row.nickname || ""} ${row.line_display_name || ""} ${row.product_name || ""} ${binding?.value || ""}`.toLocaleLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const settlement = settlementById.get(String(row.id));
      if (needsTopupOnly && !(settlement && settlement.owed > 0 && Number(row.paid_amount || 0) > 0)) return false;
      if (hasRefundDueOnly && !(settlement && settlement.refundDue > 0)) return false;
      return true;
    });

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
      appliedSessionId,
      appliedSessionName,
      orders: rows.map((row, index) => {
        const remittance = row.payment_status === "confirming" ? findLatestRemittance(String(row.id)) : null;
        // 連線代購下單改版 第三階段：有效單價改成「賣家單價 ?? 客人單價
        // ?? 舊欄位」——管理員改單價這次改回寫 seller_unit_price（見
        // PATCH route），跟客人自己填的 customer_unit_price 分開保存。
        const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
        const purchasedQuantity =
          row.purchased_quantity === null || row.purchased_quantity === undefined ? null : Number(row.purchased_quantity);
        const quantity = Number(row.quantity || 1);
        const effectiveQuantity = effectiveLivestreamQuantity(purchasedQuantity, quantity);
        const settlement = settlementById.get(String(row.id)) as ReturnType<typeof computeLivestreamSettlement>;
        return {
          id: String(row.id || ""),
          lineUserId: String(row.line_user_id || ""),
          lineDisplayName: String(row.line_display_name || ""),
          binding: bindingsByUser.get(String(row.line_user_id || "")) || null,
          nickname: String(row.nickname || ""),
          productName: row.product_name ? String(row.product_name) : "",
          unitPrice: effectiveUnitPrice,
          customerUnitPrice:
            row.customer_unit_price === null || row.customer_unit_price === undefined ? null : Number(row.customer_unit_price),
          totalPrice: effectiveUnitPrice === null ? null : effectiveUnitPrice * effectiveQuantity,
          quantity,
          purchasedQuantity,
          remittanceId: row.remittance_id ? String(row.remittance_id) : null,
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
          category: PRODUCT_CATEGORIES.has(String(row.product_category)) ? String(row.product_category) : "general",
          paidAmount: Number(row.paid_amount || 0),
          owed: settlement.owed,
          refundDue: settlement.refundDue,
          paymentChip: settlement.paymentChip,
          refundedAt: row.refunded_at ? String(row.refunded_at) : null,
          refundedAmount: row.refunded_amount === null || row.refunded_amount === undefined ? null : Number(row.refunded_amount),
          createdAt: String(row.created_at || ""),
          updatedAt: String(row.updated_at || ""),
        };
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "社群連線訂單讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

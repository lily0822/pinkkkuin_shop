import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  isSameOriginMutation,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { backendRateLimit } from "@/lib/backend-security";
import { LIVESTREAM_BANK_ACCOUNT_KEYS, LIVESTREAM_BANK_ACCOUNT_LABELS } from "@/lib/line/livestream-bank-info";
import { isLivestreamBankNameAnomaly, LIVESTREAM_STANDARD_BANK_NAMES } from "@/lib/line/livestream-bank-aliases";
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
// 跟 customer-summary 那支一樣，沒有真正分頁，直接抓一個夠大的上限。
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

type OrderRow = {
  id: string;
  line_user_id: string | null;
  line_display_name: string | null;
  product_name: string | null;
  unit_price: number | null;
  customer_unit_price: number | null;
  seller_unit_price: number | null;
  quantity: number | null;
  purchased_quantity: number | null;
  payment_status: string | null;
  photo_storage_path: string | null;
  paid_amount: number | null;
  refunded_at: string | null;
  refunded_amount: number | null;
  created_at: string | null;
};

function orderSettlement(order: OrderRow) {
  const unitPrice = effectiveLivestreamUnitPrice(order.seller_unit_price, order.customer_unit_price, order.unit_price);
  return computeLivestreamSettlement({
    effectiveUnitPrice: unitPrice,
    quantity: Number(order.quantity || 1),
    purchasedQuantity: order.purchased_quantity,
    paidAmount: Number(order.paid_amount || 0),
    refundedAt: order.refunded_at,
    refundedAmount: order.refunded_amount,
  });
}

type RemittanceRow = {
  id: string;
  line_user_id: string | null;
  nickname: string | null;
  bank_name: string | null;
  account_last5: string | null;
  amount: number | null;
  expected_amount_at_submit: number | null;
  order_ids: string[] | null;
  session_id: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

type OrderSummary = {
  id: string;
  productName: string;
  photoUrl: string | null;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

export async function GET(request: NextRequest) {
  const guard = await guardBackendRequest(request);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_remittances_list", 60);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const incoming = new URL(request.url);
  const q = (incoming.searchParams.get("q") || "").trim().toLocaleLowerCase().slice(0, 120);
  // bank 是 LIVESTREAM_BANK_ACCOUNT_KEYS 其中一個 key（zhongxin/fubon/
  // cathay）或 'anomaly'；空字串＝不篩選（對應前端的「全部」）。用 key
  // 而不是直接傳中文名稱，跟這個 feature 其他地方（收款帳號設定）的
  // 慣例一致。
  const bankFilter = (incoming.searchParams.get("bank") || "").trim();
  // 第三階段審查修正：匯款紀錄本身「隨時開放、不限場次」，所以沒帶這個
  // 參數時不做任何場次篩選（跟上面 bank/q 一樣是純粹的篩選條件，不像
  // livestream-orders 那支預設帶入「當下連線／最近一場」）。"unassigned"
  // 對應沒有場次歸屬的舊資料（session_id is null）。
  const sessionIdFilter = (incoming.searchParams.get("sessionId") || "").trim();

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: orderData, error: orderError }, { data: remittanceData, error: remittanceError }] = await Promise.all([
      supabase
        .from("community_livestream_orders")
        .select(
          "id, line_user_id, line_display_name, product_name, unit_price, customer_unit_price, seller_unit_price, quantity, purchased_quantity, payment_status, photo_storage_path, paid_amount, refunded_at, refunded_amount, created_at",
        )
        // 連線代購下單改版 第三階段：排除 staged（客人還沒送出的暫存
        // 照片）跟 cancelled（客人自助取消的軟刪除訂單）——這條之前完全
        // 沒過濾，是第二階段發現既有疏漏那次同一類問題，這輪一併補上。
        .eq("order_status", "submitted")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
      supabase
        .from("community_livestream_remittances")
        .select(
          "id, line_user_id, nickname, bank_name, account_last5, amount, expected_amount_at_submit, order_ids, session_id, submitted_at, reviewed_at",
        )
        .order("submitted_at", { ascending: false })
        .limit(FETCH_LIMIT),
    ]);
    if (orderError) throw orderError;
    if (remittanceError) throw remittanceError;

    const orders = (Array.isArray(orderData) ? orderData : []) as OrderRow[];
    const remittances = (Array.isArray(remittanceData) ? remittanceData : []) as RemittanceRow[];

    const ordersById = new Map(orders.map((order) => [String(order.id), order]));

    // 只對實際會用到的訂單照片簽 URL（匯款紀錄關聯到的訂單 + 目前未付款
    // 的訂單）——這張表要秀的訂單是全體客人全部訂單的一個子集，沒必要
    // 每一筆都簽一次 signed URL。
    const relevantOrderIds = new Set<string>();
    remittances.forEach((remittance) => (remittance.order_ids || []).forEach((id) => relevantOrderIds.add(id)));
    orders.forEach((order) => {
      if (order.payment_status === "unpaid") relevantOrderIds.add(String(order.id));
    });

    const photoUrlEntries = await Promise.all(
      [...relevantOrderIds].map(async (id) => {
        const order = ordersById.get(id);
        const url = order?.photo_storage_path
          ? await createSignedUrl(PHOTO_BUCKET, String(order.photo_storage_path), SIGNED_URL_TTL_SECONDS)
          : null;
        return [id, url] as const;
      }),
    );
    const photoUrlById = new Map(photoUrlEntries);

    function buildOrderSummary(order: OrderRow): OrderSummary {
      // 有效單價＝賣家單價 ?? 客人單價 ?? 舊欄位；有效數量＝買到幾個
      // （還沒採買就用訂購數量）——跟後台訂單列表/依客人統計/會員中心/
      // 匯款流程同一套算法。
      const quantity = effectiveLivestreamQuantity(order.purchased_quantity, order.quantity);
      const unitPrice = effectiveLivestreamUnitPrice(order.seller_unit_price, order.customer_unit_price, order.unit_price);
      return {
        id: String(order.id),
        productName: order.product_name ? String(order.product_name) : "",
        photoUrl: photoUrlById.get(String(order.id)) || null,
        quantity,
        unitPrice,
        lineTotal: unitPrice === null ? null : unitPrice * quantity,
      };
    }

    function sumOrders(relatedOrders: OrderRow[]): number {
      return relatedOrders.reduce((sum, order) => {
        const unitPrice = effectiveLivestreamUnitPrice(order.seller_unit_price, order.customer_unit_price, order.unit_price) ?? 0;
        const quantity = effectiveLivestreamQuantity(order.purchased_quantity, order.quantity);
        return sum + unitPrice * quantity;
      }, 0);
    }

    // 「未匯款」這組要顯示的是「目前還欠多少」，不是「這批商品的應付
    // 總額」——有些項目可能已經部分付款（補差額情境），sumOrders 會
    // 把已經付過的部分也算進去，造成金額偏高。
    function sumOwed(relatedOrders: OrderRow[]): number {
      return relatedOrders.reduce((sum, order) => sum + orderSettlement(order).owed, 0);
    }

    const ordersByUser = new Map<string, OrderRow[]>();
    orders.forEach((order) => {
      const userId = String(order.line_user_id || "");
      if (!userId) return;
      if (!ordersByUser.has(userId)) ordersByUser.set(userId, []);
      ordersByUser.get(userId)!.push(order);
    });

    const remittancesByUser = new Map<string, RemittanceRow[]>();
    remittances.forEach((remittance) => {
      const userId = String(remittance.line_user_id || "");
      if (!userId) return;
      if (!remittancesByUser.has(userId)) remittancesByUser.set(userId, []);
      remittancesByUser.get(userId)!.push(remittance);
    });

    // 客人清單＝兩張表 line_user_id 的聯集——只下過單、一次都沒匯款申報
    // 過的人也要出現（只有「未匯款」那一行）。
    const allUserIds = new Set<string>([...ordersByUser.keys(), ...remittancesByUser.keys()]);

    const bankLabelFilter =
      bankFilter && bankFilter !== "anomaly" && (LIVESTREAM_BANK_ACCOUNT_KEYS as string[]).includes(bankFilter)
        ? LIVESTREAM_BANK_ACCOUNT_LABELS[bankFilter as (typeof LIVESTREAM_BANK_ACCOUNT_KEYS)[number]]
        : null;

    const bindingsByUser = await getLineUserBindingLabelsBatch([...allUserIds]);

    let customers = [...allUserIds].map((userId) => {
      const userOrders = ordersByUser.get(userId) || []; // 已經依 created_at desc 排序
      const userRemittances = (remittancesByUser.get(userId) || [])
        .slice()
        .sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime());

      const latestOrder = userOrders[0];
      const latestRemittance = userRemittances[0];
      const lineDisplayName = String(latestOrder?.line_display_name || latestRemittance?.nickname || "LINE 使用者");
      const binding = bindingsByUser.get(userId) || null;

      const remittanceList = userRemittances.map((remittance) => {
        const orderIds = remittance.order_ids || [];
        const relatedOrders = orderIds.map((id) => ordersById.get(id)).filter((order): order is OrderRow => Boolean(order));
        const systemCalculatedTotal = sumOrders(relatedOrders);
        const amount = remittance.amount === null || remittance.amount === undefined ? null : Number(remittance.amount);
        const expectedAmountAtSubmit =
          remittance.expected_amount_at_submit === null || remittance.expected_amount_at_submit === undefined
            ? null
            : Number(remittance.expected_amount_at_submit);
        const bankName = remittance.bank_name ? String(remittance.bank_name) : null;
        // 階段二（結算模型）審查修正：「金額不符」比對改成客人回報金額
        // vs 這筆匯款送出當下的快照（expectedAmountAtSubmit），不再即時
        // 重算——新模型下同一批訂單可能有多筆匯款（補差額），即時重算
        // 出來的 systemCalculatedTotal 是「這批訂單全部欠款的目前總額」，
        // 跟「這一筆匯款當時應該付多少」已經是兩個不同的數字，拿來比對
        // 會算錯。systemCalculatedTotal 繼續保留在回應裡，純供參考顯示
        // 用（目前這批商品現在的應付總額），不再是 mismatch 的比較基準。
        const needsAdjustment = relatedOrders.some((order) => {
          const settlement = orderSettlement(order);
          return settlement.owed > 0 || settlement.refundDue > 0;
        });
        return {
          id: String(remittance.id),
          bankName,
          isBankAnomaly: isLivestreamBankNameAnomaly(bankName),
          accountLast5: String(remittance.account_last5 || ""),
          amount,
          expectedAmountAtSubmit,
          systemCalculatedTotal,
          mismatch: amount !== null && expectedAmountAtSubmit !== null && amount !== expectedAmountAtSubmit,
          needsAdjustment,
          sessionId: remittance.session_id ? String(remittance.session_id) : null,
          submittedAt: String(remittance.submitted_at || ""),
          reviewedAt: remittance.reviewed_at ? String(remittance.reviewed_at) : null,
          orders: relatedOrders.map(buildOrderSummary),
        };
      });

      // 階段二（結算模型）：「未匯款」改用 owed>0 判斷，取代原本的
      // payment_status==='unpaid'——新模型下 payment_status==='confirming'
      // 的訂單（已經匯過一次）如果賣家事後調高單價，owed 可能又變成
      // 正數（需要補差額），這種訂單也該出現在這裡，手動補登才能選到它。
      const unpaidOrders = userOrders.filter((order) => orderSettlement(order).owed > 0);
      const unpaid = unpaidOrders.length
        ? { systemCalculatedTotal: sumOwed(unpaidOrders), orders: unpaidOrders.map(buildOrderSummary) }
        : null;

      return { lineUserId: userId, lineDisplayName, binding, remittances: remittanceList, unpaid };
    });

    if (q) {
      customers = customers.filter((customer) => {
        const haystack = `${customer.lineDisplayName} ${customer.binding?.value || ""}`.toLocaleLowerCase();
        return haystack.includes(q);
      });
    }

    if (bankFilter) {
      customers = customers.filter((customer) => {
        if (bankFilter === "anomaly") return customer.remittances.some((remittance) => remittance.isBankAnomaly);
        if (!bankLabelFilter) return true;
        return customer.remittances.some((remittance) => remittance.bankName === bankLabelFilter);
      });
    }

    if (sessionIdFilter) {
      customers = customers.filter((customer) => {
        if (sessionIdFilter === "unassigned") return customer.remittances.some((remittance) => !remittance.sessionId);
        return customer.remittances.some((remittance) => remittance.sessionId === sessionIdFilter);
      });
    }

    function bankRank(bankName: string | null): number {
      const index = LIVESTREAM_BANK_ACCOUNT_KEYS.findIndex((key) => LIVESTREAM_BANK_ACCOUNT_LABELS[key] === bankName);
      return index === -1 ? LIVESTREAM_BANK_ACCOUNT_KEYS.length : index; // 查無此名（異常）排在三個標準銀行之後
    }

    // 排序：先依「這個人最新一筆匯款」對應的標準銀行名稱排序，同銀行內
    // 再依匯款時間排序（新到舊）；完全沒有任何匯款紀錄的人排在整個
    // 列表最後，這些人之間依名字排序。
    customers.sort((a, b) => {
      const aHas = a.remittances.length > 0;
      const bHas = b.remittances.length > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas) return a.lineDisplayName.localeCompare(b.lineDisplayName, "zh-Hant");

      const aLatest = a.remittances[0];
      const bLatest = b.remittances[0];
      const rankDiff = bankRank(aLatest.bankName) - bankRank(bLatest.bankName);
      if (rankDiff !== 0) return rankDiff;
      return new Date(bLatest.submittedAt).getTime() - new Date(aLatest.submittedAt).getTime();
    });

    return NextResponse.json({ ok: true, customers });
  } catch {
    return NextResponse.json({ ok: false, error: "匯款紀錄讀取失敗，請稍後再試。" }, { status: 500 });
  }
}

type ManualRemittanceBody = {
  lineUserId?: unknown;
  orderIds?: unknown;
  bankName?: unknown;
  accountLast5?: unknown;
  amount?: unknown;
};

// 後台手動新增匯款紀錄——給客人一直沒辦法透過 LINE 自助完成匯款流程
// 的情況補登。階段二（結算模型）起改成直接呼叫跟 LINE 自助流程同一支
// submit_livestream_remittance RPC（202610290003 migration 改寫過），
// 不再自己手刻 insert+update 兩步——這支 RPC 本來就會鎖定、重新計算
// owed、只處理 owed>0 的項目、累加 paid_amount、決定 session_id、算
// expected_amount_at_submit，手動補登跟 LINE 自助走同一套邏輯跟同一層
// 保護（例如選到的訂單剛好已經被處理過，RPC 會回 already_remitted），
// 不用重複維護兩份幾乎一樣的邏輯。
export async function POST(request: NextRequest) {
  const guard = await guardBackendRequest(request, true);
  if (guard) return guard;

  const rate = await backendRateLimit(request, "backend_community_livestream_remittances_create", 20);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: ManualRemittanceBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "請提供正確的新增資料。" }, { status: 400 });
  }

  const lineUserId = typeof body.lineUserId === "string" ? body.lineUserId.trim() : "";
  if (!lineUserId) return NextResponse.json({ ok: false, error: "請選擇客人。" }, { status: 400 });

  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (!orderIds.length) return NextResponse.json({ ok: false, error: "請至少勾選一筆訂單。" }, { status: 400 });

  const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
  if (!LIVESTREAM_STANDARD_BANK_NAMES.includes(bankName)) {
    return NextResponse.json({ ok: false, error: "請選擇正確的銀行。" }, { status: 400 });
  }

  const accountLast5 = typeof body.accountLast5 === "string" ? body.accountLast5.trim() : "";
  if (!/^\d{5}$/.test(accountLast5)) {
    return NextResponse.json({ ok: false, error: "末五碼需為 5 碼數字。" }, { status: 400 });
  }

  let amount: number | null = null;
  if (body.amount !== null && body.amount !== undefined && body.amount !== "") {
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
      return NextResponse.json({ ok: false, error: "金額請輸入正確的數字。" }, { status: 400 });
    }
    amount = body.amount;
  }

  try {
    const supabase = createSupabaseServiceClient();

    // RPC 本身不驗證「這批 id 真的屬於這個客人」以外的事，所以這裡先
    // 查一次 line_display_name 當 nickname 快照用（手動補登沒有 LINE
    // profile 可以查，用訂單上已經存的 LINE 名稱）；真正的資格檢查（還
    // 欠多少、是否已經處理過）交給 RPC 自己鎖定+重新計算。
    const { data: sampleOrder } = await supabase
      .from("community_livestream_orders")
      .select("line_display_name")
      .eq("line_user_id", lineUserId)
      .in("id", orderIds)
      .limit(1)
      .maybeSingle();
    const lineDisplayName = String(sampleOrder?.line_display_name || "客人");

    const { data: remittanceData, error: rpcError } = await supabase
      .rpc("submit_livestream_remittance", {
        p_line_user_id: lineUserId,
        p_nickname: lineDisplayName,
        p_order_ids: orderIds,
        p_bank_name: bankName,
        p_account_last5: accountLast5,
        p_reported_amount: amount,
      })
      .single();
    // 同上（livestream-orders.ts handleRemitLast5Submission）：這支 RPC
    // 沒有在 Supabase 產生的型別清單裡登記回傳形狀。
    const remittance = remittanceData as { id: string } | null;

    if (rpcError || !remittance) {
      if (rpcError?.message?.includes("already_remitted")) {
        return NextResponse.json(
          { ok: false, error: "選取的訂單目前沒有欠款（可能已被處理），請重新整理後再試。" },
          { status: 409 },
        );
      }
      throw rpcError || new Error("submit_livestream_remittance returned no row");
    }

    return NextResponse.json({ ok: true, id: String(remittance.id) });
  } catch {
    return NextResponse.json({ ok: false, error: "新增匯款紀錄失敗，請稍後再試。" }, { status: 500 });
  }
}

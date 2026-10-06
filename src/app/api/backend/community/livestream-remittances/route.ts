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
  quantity: number | null;
  payment_status: string | null;
  photo_storage_path: string | null;
  created_at: string | null;
};

type RemittanceRow = {
  id: string;
  line_user_id: string | null;
  nickname: string | null;
  bank_name: string | null;
  account_last5: string | null;
  amount: number | null;
  order_ids: string[] | null;
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

  try {
    const supabase = createSupabaseServiceClient();

    const [{ data: orderData, error: orderError }, { data: remittanceData, error: remittanceError }] = await Promise.all([
      supabase
        .from("community_livestream_orders")
        .select("id, line_user_id, line_display_name, product_name, unit_price, quantity, payment_status, photo_storage_path, created_at")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
      supabase
        .from("community_livestream_remittances")
        .select("id, line_user_id, nickname, bank_name, account_last5, amount, order_ids, submitted_at, reviewed_at")
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
      const quantity = Number(order.quantity || 1);
      const unitPrice = order.unit_price === null || order.unit_price === undefined ? null : Number(order.unit_price);
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
        const unitPrice = order.unit_price === null || order.unit_price === undefined ? 0 : Number(order.unit_price);
        return sum + unitPrice * Number(order.quantity || 1);
      }, 0);
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

    let customers = [...allUserIds].map((userId) => {
      const userOrders = ordersByUser.get(userId) || []; // 已經依 created_at desc 排序
      const userRemittances = (remittancesByUser.get(userId) || [])
        .slice()
        .sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime());

      const latestOrder = userOrders[0];
      const latestRemittance = userRemittances[0];
      const lineDisplayName = String(latestOrder?.line_display_name || latestRemittance?.nickname || "LINE 使用者");

      const remittanceList = userRemittances.map((remittance) => {
        const orderIds = remittance.order_ids || [];
        const relatedOrders = orderIds.map((id) => ordersById.get(id)).filter((order): order is OrderRow => Boolean(order));
        const systemCalculatedTotal = sumOrders(relatedOrders);
        const amount = remittance.amount === null || remittance.amount === undefined ? null : Number(remittance.amount);
        const bankName = remittance.bank_name ? String(remittance.bank_name) : null;
        return {
          id: String(remittance.id),
          bankName,
          isBankAnomaly: isLivestreamBankNameAnomaly(bankName),
          accountLast5: String(remittance.account_last5 || ""),
          amount,
          systemCalculatedTotal,
          mismatch: amount !== null && amount !== systemCalculatedTotal,
          submittedAt: String(remittance.submitted_at || ""),
          reviewedAt: remittance.reviewed_at ? String(remittance.reviewed_at) : null,
          orders: relatedOrders.map(buildOrderSummary),
        };
      });

      const unpaidOrders = userOrders.filter((order) => order.payment_status === "unpaid");
      const unpaid = unpaidOrders.length
        ? { systemCalculatedTotal: sumOrders(unpaidOrders), orders: unpaidOrders.map(buildOrderSummary) }
        : null;

      return { lineUserId: userId, lineDisplayName, remittances: remittanceList, unpaid };
    });

    if (q) {
      customers = customers.filter((customer) => customer.lineDisplayName.toLocaleLowerCase().includes(q));
    }

    if (bankFilter) {
      customers = customers.filter((customer) => {
        if (bankFilter === "anomaly") return customer.remittances.some((remittance) => remittance.isBankAnomaly);
        if (!bankLabelFilter) return true;
        return customer.remittances.some((remittance) => remittance.bankName === bankLabelFilter);
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

// 後台手動新增匯款紀錄——給客人一直沒辦法透過 LINE 自助送出匯款格式
// 的情況補登。跟 LINE 那條路徑（handleRemittanceLast5Submission）的
// 欄位語意保持一致：nickname 存這個客人目前的 line_display_name 快照、
// 寫完紀錄後把涵蓋的訂單都改成 confirming，不然這筆手動補登的紀錄會
// 跟訂單實際狀態對不起來。
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

    // 驗證每筆 orderId 都真的屬於這個客人、而且目前還是 unpaid——避免
    // 前端被竄改或資料過期而選到不相干、或已經處理過的訂單。用「符合
    // 條件的筆數剛好等於請求的筆數」確認全部都通過，不是只檢查第一筆。
    const { data: matchedOrders, error: orderError } = await supabase
      .from("community_livestream_orders")
      .select("id, line_display_name")
      .eq("line_user_id", lineUserId)
      .eq("payment_status", "unpaid")
      .in("id", orderIds);
    if (orderError) throw orderError;

    const matchedRows = Array.isArray(matchedOrders) ? matchedOrders : [];
    if (matchedRows.length !== orderIds.length) {
      return NextResponse.json(
        { ok: false, error: "選取的訂單有變化（可能已被處理），請重新整理後再試。" },
        { status: 409 },
      );
    }

    const lineDisplayName = String(matchedRows[0]?.line_display_name || "客人");

    const { data: inserted, error: insertError } = await supabase
      .from("community_livestream_remittances")
      .insert({
        line_user_id: lineUserId,
        nickname: lineDisplayName,
        order_ids: orderIds,
        bank_name: bankName,
        account_last5: accountLast5,
        amount,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from("community_livestream_orders")
      .update({ payment_status: "confirming" })
      .in("id", orderIds);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, id: String(inserted.id) });
  } catch {
    return NextResponse.json({ ok: false, error: "新增匯款紀錄失敗，請稍後再試。" }, { status: 500 });
  }
}

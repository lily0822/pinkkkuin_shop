import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 比照 .backend-product-publish/lily-backend-Code.gs 裡
// syncSupabaseBackendOrder/readSupabaseBackendOrders 的邏輯原樣搬過來。
// orders 這張表是廠商叫貨明細/購物網站叫貨明細/客戶訂單明細三個頁籤
// 共用的同一張表，沒有 type 欄位區分——純粹靠 vendorId 落在哪個 id
// 空間（真實廠商 id / 真實網站 id / 固定的 CUSTOMER_ORDER_SOURCE_ID
// 特殊值）由前端分流篩選，這裡不用、也不該另外重做一套分流邏輯。
//
// 有一個刻意保留、不是我發明的既有怪異行為一定要記住：前端舊的
// fetchAPI('saveOrder', ...) 在送出前會把 { isMeta:true, orderNo,
// trackingNo, shipped, shippedDate } 這個 meta 物件 unshift 進
// order.items 陣列最前面再送出，Apps Script 原封不動把這個
// （已經包含 meta 項目的）items 陣列存進 Supabase 的 items 欄位；
// 讀回來的時候，前端的 processAPIData() 會把 items[0].isMeta 這個
// 標記物件再 shift 出來，用它覆蓋掉 order 層級的 orderNo/trackingNo/
// shipped/shippedDate，剩下的才是真正的商品明細。這代表 orderNo/
// trackingNo/shipped/shippedDate 在 Supabase 裡其實是「雙重存放」：
// 一份在 orders 表自己的欄位，一份包在 items[0] 這個 meta 項目裡。
// 看起來是舊 Sheets 時代遺留下來的設計，不是這輪要修的範圍——
// processAPIData() 完全沒有改，為了不讓既有/未來任何一筆訂單的讀取
// 行為跑掉，這裡在存檔時原樣重建這個 meta 項目再寫進 items，讀取時
// 原樣把 items 整包（含 meta 項目）傳回去，兩邊都不擅自「修正」。

type BackendOrderItemInput = Record<string, unknown>;

export type BackendOrderPayload = {
  id?: string | number;
  date?: string;
  vendorId?: string | number;
  orderNo?: string;
  trackingNo?: string;
  shipped?: string;
  shippedDate?: string;
  items?: BackendOrderItemInput[];
};

export type BackendOrder = {
  id: string;
  date: string;
  vendorId: string;
  orderNo: string;
  trackingNo: string;
  shipped: string;
  shippedDate: string;
  items: unknown[];
};

type RawOrderRow = {
  id: string;
  legacy_id: string | null;
  date: string | null;
  vendor_id: string | null;
  order_no: string | null;
  tracking_no: string | null;
  shipped: string | null;
  shipped_date: string | null;
  items: unknown;
};

function mapOrderRow(row: RawOrderRow): BackendOrder {
  return {
    id: String(row.legacy_id || row.id),
    date: row.date || "",
    vendorId: row.vendor_id || "",
    orderNo: row.order_no || "",
    trackingNo: row.tracking_no || "",
    shipped: row.shipped || "",
    shippedDate: row.shipped_date || "",
    items: Array.isArray(row.items) ? row.items : [],
  };
}

export async function listBackendOrders(): Promise<BackendOrder[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("backend_orders")
    .select("id,legacy_id,date,vendor_id,order_no,tracking_no,shipped,shipped_date,items")
    .order("created_at", { ascending: false })
    .returns<RawOrderRow[]>();
  if (error) throw error;
  return (data || []).map(mapOrderRow);
}

export async function saveBackendOrder(order: BackendOrderPayload): Promise<BackendOrder> {
  if (!order) throw new Error("請提供訂單資料。");
  const legacyId = String(order.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const cleanItems = Array.isArray(order.items) ? order.items : [];
  // 比照舊的 fetchAPI('saveOrder', ...) 在送出前做的事：把 meta 項目
  // unshift 回 items 最前面，讓既有的 processAPIData() 讀取邏輯不用改。
  const itemsWithMeta = [
    {
      isMeta: true,
      orderNo: order.orderNo || "",
      trackingNo: order.trackingNo || "",
      shipped: order.shipped || "未出貨",
      shippedDate: order.shippedDate || "",
    },
    ...cleanItems,
  ];

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("backend_orders")
    .upsert(
      {
        legacy_id: legacyId,
        date: order.date || "",
        vendor_id: order.vendorId !== undefined && order.vendorId !== null ? String(order.vendorId) : "",
        order_no: order.orderNo || "",
        tracking_no: order.trackingNo || "",
        shipped: order.shipped || "",
        shipped_date: order.shippedDate || "",
        items: itemsWithMeta,
      },
      { onConflict: "legacy_id" },
    )
    .select("id,legacy_id,date,vendor_id,order_no,tracking_no,shipped,shipped_date,items")
    .limit(1)
    .returns<RawOrderRow[]>();
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Supabase 訂單儲存未回傳資料。");
  return mapOrderRow(row);
}

export async function deleteBackendOrder(legacyId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("backend_orders").delete().eq("legacy_id", legacyId);
  if (error) throw error;
}

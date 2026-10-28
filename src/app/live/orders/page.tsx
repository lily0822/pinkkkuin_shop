import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentOrMostRecentSession } from "@/lib/line/livestream-sessions";
import { effectiveLivestreamUnitPrice } from "@/lib/line/livestream-pricing";
import { getLivestreamKeywordSettings } from "@/lib/line/livestream-keywords";
import { getLiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import { LiveOrdersView, type LiveOrderItem, type LiveOrderStatusChip } from "@/components/live-orders-view";
import { LiveErrorScreen } from "@/components/live-error-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "我的訂單" };

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 跟連結本身的 60 分鐘有效期一致

type OrderRow = {
  id: string;
  product_name: string | null;
  photo_storage_path: string | null;
  quantity: number;
  customer_unit_price: number | null;
  seller_unit_price: number | null;
  unit_price: number | null;
  purchased_quantity: number | null;
  remittance_id: string | null;
  purchase_status: string | null;
  payment_status: string | null;
};

// 客人專用頁面改成單一狀態標籤（取代原本「採買狀態」+「付款狀態」兩個
// 分開的小標籤）：已匯款優先於其他任何狀態（進了匯款流程就鎖定，不管
// 採買結果如何）；其餘依 purchased_quantity 判斷——null 是還沒採買、
// 0 是缺貨、等於訂購數量是已買到、其餘是買到一部分。
function computeStatusChip(
  remittanceId: string | null,
  purchasedQuantity: number | null,
  quantity: number,
): LiveOrderStatusChip {
  if (remittanceId !== null) return { label: "已匯款", tone: "paid" };
  if (purchasedQuantity === null) return { label: "待採買", tone: "pending" };
  if (purchasedQuantity === 0) return { label: "缺貨", tone: "out" };
  if (purchasedQuantity >= quantity) return { label: "已買到", tone: "done" };
  return { label: `買到 ${purchasedQuantity}・缺 ${quantity - purchasedQuantity}`, tone: "partial" };
}

export default async function LiveOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token || "";
  const payload = verifyLivestreamMagicLink(token, "order-edit");
  if (!payload) {
    return <LiveErrorScreen title="連結已過期" message="請回到 LINE 重新按「查詢訂單」或「取消訂單」。" />;
  }

  const supabase = createSupabaseServiceClient();

  // 「目前這一波連線」：有進行中的場次就是那一場，沒有就退而求其次抓
  // 最近一場已開始的場次（跟後台訂單列表預設篩選共用同一個定義）。真的
  // 一場都沒建立過（理論上不會發生，只是防呆）就不篩選 session_id，
  // 顯示這個客人全部送出過的訂單，總比給他一個空白頁好。
  const session = await getCurrentOrMostRecentSession(supabase);

  let query = supabase
    .from("community_livestream_orders")
    .select(
      "id, product_name, photo_storage_path, quantity, customer_unit_price, seller_unit_price, unit_price, purchased_quantity, remittance_id, purchase_status, payment_status",
    )
    .eq("line_user_id", payload.lineUserId)
    .eq("order_status", "submitted")
    .order("created_at", { ascending: true });
  if (session) query = query.eq("session_id", session.id);

  const { data } = await query;
  const rows = (data as OrderRow[] | null) || [];

  // 未匯款金額：跟第三階段「連線」匯款清單同一套規則——還沒匯款
  // （remittance_id 是 null）的項目裡，缺貨（purchased_quantity===0）
  // 不計入，其餘用「買到幾個（還沒採買就用訂購數量）× 有效單價」加總，
  // 讓這個頁面看到的金額跟實際跑一次匯款流程算出來的金額一致。用獨立
  // 的 reduce 算，不跟下面抓 signed URL 的 async map 混在一起，避免在
  // async 函式裡 reassign 閉包變數。
  const unpaidTotal = rows.reduce((sum, row) => {
    if (row.remittance_id !== null) return sum;
    if (row.purchased_quantity === 0) return sum; // 缺貨，不計入
    const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
    if (effectiveUnitPrice === null) return sum;
    const effectiveQty = row.purchased_quantity ?? row.quantity;
    return sum + effectiveQty * effectiveUnitPrice;
  }, 0);

  const items: LiveOrderItem[] = await Promise.all(
    rows.map(async (row) => {
      const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
      const lockReason: "remitted" | "purchased" | null =
        row.remittance_id !== null ? "remitted" : row.purchased_quantity !== null ? "purchased" : null;
      return {
        id: row.id,
        productName: row.product_name,
        photoUrl: row.photo_storage_path
          ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, SIGNED_URL_TTL_SECONDS)
          : null,
        quantity: row.quantity,
        unitPrice: effectiveUnitPrice,
        purchasedQuantity: row.purchased_quantity,
        lockReason,
        statusChip: computeStatusChip(row.remittance_id, row.purchased_quantity, row.quantity),
      };
    }),
  );

  const { keywords } = await getLivestreamKeywordSettings();
  const orderQueryKeyword = keywords.order_query[0];

  const identity = await getLiveCustomerIdentity(payload.lineUserId);

  return (
    <LiveOrdersView
      token={token}
      sessionName={session?.name || null}
      unpaidTotal={unpaidTotal}
      initialItems={items}
      orderQueryKeyword={orderQueryKeyword}
      identity={identity}
    />
  );
}

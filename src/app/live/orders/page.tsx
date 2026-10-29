import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentOrMostRecentSession } from "@/lib/line/livestream-sessions";
import {
  effectiveLivestreamUnitPrice,
  computeLivestreamPurchaseChip,
  computeLivestreamSettlement,
} from "@/lib/line/livestream-pricing";
import { getLivestreamKeywordSettings } from "@/lib/line/livestream-keywords";
import { getLiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import { LiveOrdersView, type LiveOrderItem } from "@/components/live-orders-view";
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
  paid_amount: number;
  refunded_at: string | null;
  refunded_amount: number | null;
  product_category: "general" | "gacha";
};

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
      "id, product_name, photo_storage_path, quantity, customer_unit_price, seller_unit_price, unit_price, purchased_quantity, paid_amount, refunded_at, refunded_amount, product_category",
    )
    .eq("line_user_id", payload.lineUserId)
    .eq("order_status", "submitted")
    .order("created_at", { ascending: true });
  if (session) query = query.eq("session_id", session.id);

  const { data } = await query;
  const rows = (data as OrderRow[] | null) || [];

  // 階段二（結算模型）：每個項目同時算出採買狀態標籤、付款狀態標籤、
  // 分組（還沒匯款／已匯款）——跟聊天室查詢訂單（livestream-orders.ts
  // 的 handleOrderManageTrigger）同一套共用函式，兩邊的分組/標籤/金額
  // 一定一致。鎖定規則改成「purchased_quantity 不為空，或 paid_amount>0」
  // （取代原本以 remittance_id 判斷——新模型下 remittance_id 只代表
  // 「曾經匯過款」，同一筆訂單之後還可能被補款，不能再拿它當唯一的鎖定
  // 依據）。
  const items: LiveOrderItem[] = await Promise.all(
    rows.map(async (row) => {
      const effectiveUnitPrice = effectiveLivestreamUnitPrice(row.seller_unit_price, row.customer_unit_price, row.unit_price);
      const settlement = computeLivestreamSettlement({
        effectiveUnitPrice,
        quantity: row.quantity,
        purchasedQuantity: row.purchased_quantity,
        paidAmount: row.paid_amount,
        refundedAt: row.refunded_at,
        refundedAmount: row.refunded_amount,
      });
      const lockReason: "remitted" | "purchased" | null =
        row.purchased_quantity !== null ? "purchased" : row.paid_amount > 0 ? "remitted" : null;
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
        purchaseChip: computeLivestreamPurchaseChip(row.purchased_quantity, row.quantity),
        paymentChip: settlement.paymentChip,
        group: settlement.group,
        owed: settlement.owed,
        refundDue: settlement.refundDue,
        paidAmount: row.paid_amount,
        category: row.product_category,
      };
    }),
  );

  const unpaidItems = items.filter((item) => item.group === "unpaid");
  const paidItems = items.filter((item) => item.group === "paid");
  const unpaidTotal = unpaidItems.reduce((sum, item) => sum + item.owed, 0);
  const paidTotal = paidItems.reduce((sum, item) => sum + item.paidAmount, 0);
  const refundDueTotal = paidItems.reduce((sum, item) => sum + item.refundDue, 0);

  const { keywords } = await getLivestreamKeywordSettings();
  const orderQueryKeyword = keywords.order_query[0];

  const identity = await getLiveCustomerIdentity(payload.lineUserId);

  return (
    <LiveOrdersView
      token={token}
      sessionName={session?.name || null}
      unpaidTotal={unpaidTotal}
      paidTotal={paidTotal}
      refundDueTotal={refundDueTotal}
      unpaidItems={unpaidItems}
      paidItems={paidItems}
      orderQueryKeyword={orderQueryKeyword}
      identity={identity}
    />
  );
}

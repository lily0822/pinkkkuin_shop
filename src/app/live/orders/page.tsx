import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentOrMostRecentSession } from "@/lib/line/livestream-sessions";
import { effectiveLivestreamUnitPrice } from "@/lib/line/livestream-pricing";
import { getLivestreamKeywordSettings } from "@/lib/line/livestream-keywords";
import { LiveOrdersView, type LiveOrderItem } from "@/components/live-orders-view";

export const dynamic = "force-dynamic";

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 跟連結本身的 60 分鐘有效期一致

function ExpiredNotice() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-penguin-cream px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border-2 border-penguin-peach bg-white p-6 text-center shadow-sm">
        <p className="text-base font-black text-penguin-gray">連結已過期</p>
        <p className="mt-3 text-sm leading-6 text-penguin-gray">
          請回到 LINE 重新按「查詢訂單」或「取消訂單」。
        </p>
      </div>
    </main>
  );
}

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

export default async function LiveOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token || "";
  const payload = verifyLivestreamMagicLink(token, "order-edit");
  if (!payload) {
    return <ExpiredNotice />;
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
        purchaseStatus: row.purchase_status || "not_bought",
        paymentStatus: row.payment_status || "unpaid",
      };
    }),
  );

  const { keywords } = await getLivestreamKeywordSettings();
  const orderQueryKeyword = keywords.order_query[0];

  return (
    <LiveOrdersView
      token={token}
      sessionName={session?.name || null}
      unpaidTotal={unpaidTotal}
      initialItems={items}
      orderQueryKeyword={orderQueryKeyword}
    />
  );
}

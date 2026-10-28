import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentSession } from "@/lib/line/livestream-sessions";
import { getLivestreamKeywordSettings } from "@/lib/line/livestream-keywords";
import { getLiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import { LiveConfirmForm, type LiveConfirmItem } from "@/components/live-confirm-form";
import { LiveErrorScreen } from "@/components/live-error-screen";

export const dynamic = "force-dynamic";

// 中性標題，不出現網站名稱或「購物」之類字眼——客人不該在這個頁面
// 感覺到背後有個網站。
export const metadata: Metadata = { title: "連線下單" };

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 跟連結本身的 60 分鐘有效期一致

export default async function LiveConfirmPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token || "";
  const payload = verifyLivestreamMagicLink(token, "order-confirm");
  if (!payload) {
    return <LiveErrorScreen title="連結已過期" message="請回到 LINE 重新按「傳好了」或「查詢訂單」。" />;
  }

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("community_livestream_orders")
    .select("id, photo_storage_path")
    .eq("line_user_id", payload.lineUserId)
    .eq("order_status", "staged")
    .order("created_at", { ascending: true });

  const rows = (data as { id: string; photo_storage_path: string | null }[] | null) || [];

  const items: LiveConfirmItem[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      photoUrl: row.photo_storage_path
        ? await createSignedUrl(PHOTO_BUCKET, row.photo_storage_path, SIGNED_URL_TTL_SECONDS)
        : null,
    })),
  );

  // 這裡只是給頁面顯示場次名稱用——真正的「場次還在不在進行中」一定要
  // 在送出當下（/api/live/confirm/submit）重新查一次，不能信任這裡載入
  // 頁面當下的結果：客人填單價可能花超過場次剩餘的時間。
  const session = await getCurrentSession(supabase);

  // 送出成功後用 LIFF sendMessages 幫客人送出「查詢訂單」關鍵字——用
  // 後台目前設定的第一個詞（可能被改過），不寫死「查詢訂單」三個字，
  // 保證一定會命中 handleTextMessage 的比對（見 livestream-keywords.ts）。
  const { keywords } = await getLivestreamKeywordSettings();
  const orderQueryKeyword = keywords.order_query[0];

  const identity = await getLiveCustomerIdentity(payload.lineUserId);

  return (
    <LiveConfirmForm
      token={token}
      sessionName={session?.name || null}
      initialItems={items}
      orderQueryKeyword={orderQueryKeyword}
      identity={identity}
    />
  );
}

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignedUrl } from "@/lib/supabase/storage";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getCurrentSession } from "@/lib/line/livestream-sessions";
import { LiveConfirmForm, type LiveConfirmItem } from "@/components/live-confirm-form";

export const dynamic = "force-dynamic";

const PHOTO_BUCKET = "community-livestream-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 跟連結本身的 60 分鐘有效期一致

function ExpiredNotice() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-penguin-cream px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border-2 border-penguin-peach bg-white p-6 text-center shadow-sm">
        <p className="text-base font-black text-penguin-gray">連結已過期</p>
        <p className="mt-3 text-sm leading-6 text-penguin-gray">
          請回到 LINE 重新按「傳好了」或「查詢訂單」。
        </p>
      </div>
    </main>
  );
}

export default async function LiveConfirmPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token || "";
  const payload = verifyLivestreamMagicLink(token, "order-confirm");
  if (!payload) {
    return <ExpiredNotice />;
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

  return <LiveConfirmForm token={token} sessionName={session?.name || null} initialItems={items} />;
}

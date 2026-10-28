import type { Metadata } from "next";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyLivestreamMagicLink } from "@/lib/line/livestream-magic-link";
import { getLiveCustomerIdentity } from "@/lib/line/live-customer-identity";
import { LiveErrorScreen } from "@/components/live-error-screen";
import { LiveBindForm, type LiveBindCurrent } from "@/components/live-bind-form";
import type { LiveBindingType } from "@/lib/line/live-identity-validation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "綁定社群帳號" };

type IdentityRow = {
  binding_type: string | null;
  binding_value: string | null;
};

export default async function LiveBindPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token || "";
  const payload = verifyLivestreamMagicLink(token, "bind");
  if (!payload) {
    return <LiveErrorScreen title="連結已過期" message="請回到 LINE 重新輸入「綁定」。" />;
  }

  const mode = params?.mode === "edit" ? "edit" : "bind";

  // 這個頁面自己的「目前有沒有綁定」只看新表（community_line_identities）
  // ——跟 submit_community_line_identity RPC 判斷要 bind 還是 edit 的依據
  // 完全一致，不要混進舊表的核准暱稱（避免「頁面說你已經綁定過了」但
  // RPC 卻當成全新綁定這種不一致）。上方客人身分列（LiveIdentityRow）
  // 另外走 getLiveCustomerIdentity() 的新舊表合併邏輯，純粹是展示用途，
  // 跟這裡的表單狀態判斷是兩回事。
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("community_line_identities")
    .select("binding_type, binding_value")
    .eq("line_user_id", payload.lineUserId)
    .maybeSingle();
  const row = data as IdentityRow | null;
  const current: LiveBindCurrent | null =
    row?.binding_type && row?.binding_value
      ? { type: row.binding_type as LiveBindingType, value: row.binding_value }
      : null;

  const identity = await getLiveCustomerIdentity(payload.lineUserId);

  return <LiveBindForm token={token} mode={mode} current={current} identity={identity} />;
}

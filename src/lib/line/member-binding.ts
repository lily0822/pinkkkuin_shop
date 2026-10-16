import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type LineBindingFailureReason = "line-already-linked" | "member-already-linked" | "already-linked" | "link-failed";

export type LineBindingResult =
  | { ok: true; userId: string; alreadyLinked: boolean }
  | { ok: false; reason: LineBindingFailureReason };

// 從 /api/member/line/callback 原本寫在 route handler 裡的綁定邏輯抽出來
// ——那支 route 是「使用者已經登入，現在要把目前這個 LINE 身份連結到
// 自己的帳號」這個場景，跟下面 findOrCreateMemberForLineUser()（給
// 第二期 webhook 直接綁定用，那邊沒有「已登入的使用者」這個前提，是
// 從零開始找或建帳號）是兩種不同的起點，所以是兩支不同的函式，不是
// 同一支函式硬塞兩種用法——但「查重複/寫入 member_line_accounts」這段
// 真正的綁定動作只有一份，不要兩邊各寫一次。
export async function linkLineAccountToExistingUser(
  service: SupabaseServiceClient,
  userId: string,
  lineUserId: string,
): Promise<LineBindingResult> {
  const [{ data: sameLine }, { data: sameUser }] = await Promise.all([
    service.from("member_line_accounts").select("user_id,line_user_id").eq("line_user_id", lineUserId).limit(1).maybeSingle(),
    service.from("member_line_accounts").select("user_id,line_user_id").eq("user_id", userId).limit(1).maybeSingle(),
  ]);

  if (sameLine && sameLine.user_id !== userId) {
    return { ok: false, reason: "line-already-linked" };
  }
  if (sameUser && sameUser.line_user_id !== lineUserId) {
    return { ok: false, reason: "member-already-linked" };
  }
  if (sameUser && sameUser.line_user_id === lineUserId) {
    return { ok: true, userId, alreadyLinked: true };
  }

  const { error } = await service.from("member_line_accounts").insert({ user_id: userId, line_user_id: lineUserId });
  if (error) {
    return { ok: false, reason: "link-failed" };
  }
  return { ok: true, userId, alreadyLinked: false };
}

export type FindOrCreateMemberResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string };

// 第二期（LINE webhook 直接綁定）才會真的呼叫到這支——這裡先把它寫好、
// 放著，這一期（地基）不接線。查不到既有綁定時，用一個合成的
// placeholder email 建一個全新的 Supabase auth 帳號（已經對 Staging
// 實測過：auth.admin.createUser 完全不給 email/phone 會被 GoTrue 擋
// （validation_failed），給合成 email + email_confirm:true 會成功，
// 而且之後用同一個 email 呼叫 generateLink({type:"magiclink"}) 一樣
// 能正常拿到 hashed_token，跟現有 OAuth callback 的 session-minting
// 做法完全相容）。這個 email 純粹是滿足 Supabase auth 的技術要求，
// 不是真的聯絡方式，不會被用來發信。
export async function findOrCreateMemberForLineUser(
  service: SupabaseServiceClient,
  lineUserId: string,
): Promise<FindOrCreateMemberResult> {
  const { data: existing } = await service
    .from("member_line_accounts")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (existing?.user_id) {
    return { ok: true, userId: existing.user_id, created: false };
  }

  const placeholderEmail = `line-${lineUserId}@line.placeholder.invalid`;
  const { data, error } = await service.auth.admin.createUser({
    email: placeholderEmail,
    email_confirm: true,
    app_metadata: { provider: "line_webhook" },
  });
  if (error || !data.user) {
    return { ok: false, error: error?.message || "create_user_failed" };
  }

  const { error: insertError } = await service
    .from("member_line_accounts")
    .insert({ user_id: data.user.id, line_user_id: lineUserId });
  if (insertError) {
    // 綁定沒寫進去就不要留一個綁不到任何 LINE 身份的孤兒帳號。
    await service.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: "bind_failed" };
  }

  return { ok: true, userId: data.user.id, created: true };
}

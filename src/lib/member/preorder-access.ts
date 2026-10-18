import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMemberDisabled } from "@/lib/member/status";

export type PreorderAccess = {
  hasAccess: boolean;
  // 給門禁提示文案用：區分「根本沒登入」跟「已登入但沒綁定 LINE」
  // 兩種情況，指向不同的 CTA（/login vs /member/account）。
  isLoggedIn: boolean;
};

// 預購獨立流程 第三期：預購內容的存取資格——完成 LINE 會員綁定
// （member_line_accounts 有一列這個 user_id）才算有資格，跟登入與否是
// 兩件事（單純用 email/Google 登入、沒綁定 LINE 的會員一樣沒有資格）。
// 停用中的會員一律沒有資格，跟其他會員限定功能的既有慣例一致。
//
// 呼叫端的責任：這支函式只回答「有沒有資格」，真正的門禁要靠呼叫端
// 在資格確認之前，完全不要把預購商品資料（名稱/圖片/價格/描述等）
// 放進任何會傳給 client component 的 props——伺服器端算完就丟掉的
// 資料不會被序列化進 RSC payload，但只要傳進一個 client component 的
// props，就已經送到瀏覽器了，之後再怎麼用前端判斷隱藏都沒用。
export async function getPreorderAccess(): Promise<PreorderAccess> {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return { hasAccess: false, isLoggedIn: false };

  if (await isMemberDisabled(supabase, user.id)) return { hasAccess: false, isLoggedIn: true };

  const { data } = await supabase.from("member_line_accounts").select("user_id").eq("user_id", user.id).maybeSingle();
  return { hasAccess: Boolean(data?.user_id), isLoggedIn: true };
}

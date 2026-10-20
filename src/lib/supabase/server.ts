import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

// 用 React cache() 包起來——同一個請求（layout + header + footer + 頁面
// 本身，全部算在同一次 render）裡不管呼叫幾次 createSupabaseServerClient()
// 都拿到同一個 client 實例，不會重複讀 cookies()/重新建立。跨請求不受
// 影響（cache() 的記憶範圍就是一次 render，下一個請求會重新建立）。
export const createSupabaseServerClient = cache(async () => {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes sessions.
        }
      },
    },
  });
});

// supabase.auth.getUser() 本身會向 Supabase Auth 伺服器重新驗證一次
// JWT（不是單純讀 cookie），同一個請求裡光是 site-header.tsx + 會員
// layout + 會員頁面本身就可能各自呼叫一次，變成 2~3 次重複的驗證往返。
// 包成 cache() 之後同一個請求裡不管幾個地方呼叫 getCachedAuthUser()，
// 實際的驗證往返只會真正發生一次，其他呼叫都拿同一份快取結果——回傳
// 連 supabase client 一起給，呼叫端後面要再查其他表就不用另外呼叫
// createSupabaseServerClient()（雖然那支也快取了，呼叫一次成本很低，
// 但直接給更省事）。
export const getCachedAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.getUser();
  return { supabase, data: result.data, error: result.error };
});

export function safeRelativePath(value: string | null | undefined, fallback = "/member") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

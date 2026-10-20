import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

// supabase-js 在沒有自訂 cookieOptions.name 時，預設的 session cookie
// 名稱是 `sb-${專案 ref}-auth-token`（算法見 node_modules/@supabase/
// supabase-js/dist/main/SupabaseClient.js 的 defaultStorageKey：
// `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`）——這個
// 專案全部地方（route/server/middleware 自己這支）都沒有傳
// cookieOptions.name，一律吃這個預設值，所以可以放心用同一個算法反推
// cookie 名稱前綴。session 太大時會被切成 `${prefix}.0`/`.1`/... 多個
// cookie（也是這個專案已經實測確認過的行為），所以比對用 startsWith
// 不是精確比對。
function getAuthCookiePrefix(supabaseUrl: string) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

function hasSupabaseAuthCookie(request: NextRequest, supabaseUrl: string) {
  const prefix = getAuthCookiePrefix(supabaseUrl);
  return request.cookies.getAll().some((cookie) => cookie.name === prefix || cookie.name.startsWith(`${prefix}.`));
}

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  try {
    const { url, anonKey } = getSupabasePublicConfig();

    // 匿名訪客（完全沒帶 Supabase auth cookie）沒有 session 可以驗證，
    // 原本的流程還是會建立 client、呼叫 supabase.auth.getUser()——這支
    // 會向 Supabase Auth 伺服器打一次網路請求，對完全沒有登入過的訪客
    // 來說純粹是白跑一趟。有帶 cookie（不管是不是已經過期，過期也要走
    // 下面原本的驗證/刷新流程）才進入原本的完整驗證邏輯，行為跟修改前
    // 完全一樣，不受這次改動影響。
    if (!hasSupabaseAuthCookie(request, url)) return response;

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    await supabase.auth.getUser();
  } catch {
    return response;
  }

  return response;
}

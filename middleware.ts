import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSupabaseSession(request);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  // 客人專用頁面（LIFF 開啟，見 src/app/live/layout.tsx）不要被搜尋引擎
  // 收錄——頁面本身也有 <meta name="robots"> 雙保險，這裡額外加回應
  // 標頭，涵蓋直接讀 HTTP 標頭、不解析 HTML 的爬蟲。
  if (request.nextUrl.pathname.startsWith("/live")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

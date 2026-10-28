import type { Metadata } from "next";
import { LiveEntry } from "@/components/live-entry";

export const metadata: Metadata = {
  title: "連線下單",
  robots: { index: false, follow: false },
};

// LIFF 的 Endpoint URL（https://xxx.vercel.app/live）本身的入口頁——負責接住
// LINE 授權流程導回來的 liff.state，再轉去 /live/confirm、/live/orders 等
// 真正的頁面。細節與原因見 src/components/live-entry.tsx。
export default function LiveIndexPage() {
  return <LiveEntry />;
}

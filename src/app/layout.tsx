import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { StagingBadge } from "@/components/staging-badge";

export const dynamic = "force-dynamic";

const notoSansTc = Noto_Sans_TC({
  variable: "--font-noto-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata: Metadata = {
  title: "社群訂單查詢 | 小企鵝選物",
  description: "查詢社群下單明細與匯款金額。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className={notoSansTc.variable}>
      <body className="font-sans antialiased">
        <StagingBadge />
        {children}
      </body>
    </html>
  );
}

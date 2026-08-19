import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const notoSansTc = Noto_Sans_TC({
  variable: "--font-noto-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata: Metadata = {
  title: "小企鵝選物 | 日本限定・可愛雜貨代購",
  description: "日本限定、現貨、預購與連線代購選物商城。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className={notoSansTc.variable}>
      <body className="font-sans antialiased">
        <CartProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
          <a
            href="https://line.me/R/ti/p/@pinkkkuin"
            className="fixed bottom-4 left-4 z-40 rounded-full border-2 border-white bg-[#06C755] px-4 py-2.5 text-xs font-black text-white shadow-lg transition hover:scale-105 sm:text-sm"
          >
            LINE 小企鵝
          </a>
        </CartProvider>
      </body>
    </html>
  );
}

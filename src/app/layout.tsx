import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pinkkkuin / 小企鵝選物",
  description: "日本可愛雜貨與角色商品型錄，支援 IG / LINE 私訊下單。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <SiteHeader />
        {children}
        <SiteFooter />
        <a
          href="https://line.me/R/ti/p/@pinkkkuin"
          className="fixed bottom-4 left-4 right-4 z-40 rounded-full bg-brand-pink-dark px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-pink-200 sm:hidden"
        >
          聯絡下單
        </a>
      </body>
    </html>
  );
}

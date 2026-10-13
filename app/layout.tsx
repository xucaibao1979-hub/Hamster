import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "资产管理 · AssetHub",
  description: "公司资产台账与全生命周期管理",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小仓鼠资产管理平台",
  description: "每件资产，都有自己的位置。",
  icons: {
    icon: "/brand.png",
    shortcut: "/brand.png",
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

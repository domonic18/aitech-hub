import type { Metadata } from "next";

import "./globals.css";

/** 中文系统字体栈,不加载大 webfont(04 文档 §3);M3 再补完整 metadata 体系 */
export const metadata: Metadata = {
  title: {
    default: "一起AI技术",
    template: "%s | 一起AI技术",
  },
  description: "一起AI技术:AI 工程实战原创博客",
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

import { Suspense } from "react";

import Footer from "@/components/site/Footer";
import Header from "@/components/site/Header";
import StatsBeacon from "@/components/site/StatsBeacon";

/** 公开站壳(arch/07-frontend §1):Header/Footer + 全站 beacon 采集挂载点 */
export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {/* 版心由各页自管:内容页 768px(PostListView/静态页),首页 Hub 全宽 --site-max-w */}
      <main className="w-full flex-1 px-4 py-8 sm:px-6">{children}</main>
      <Footer />
      {/* Suspense:beacon 读 useSearchParams(/search 带词上报),静态预渲染页必须包 */}
      <Suspense fallback={null}>
        <StatsBeacon />
      </Suspense>
    </div>
  );
}

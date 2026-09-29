import Footer from "@/components/site/Footer";
import Header from "@/components/site/Header";
import StatsBeacon from "@/components/site/StatsBeacon";

/** 公开站壳(04 文档 §1):Header/Footer + 全站 beacon 采集挂载点 */
export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      <Footer />
      <StatsBeacon />
    </div>
  );
}

import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import ArticleBody from "@/components/article/ArticleBody";
import { agreementHtml } from "@/content/agreement";

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "用户协议",
    description: `${siteTitle}网站用户协议。`,
    alternates: { canonical: "/agreement/" },
  };
}

/** 用户协议(requirement §3.1:迁移旧文本,见 src/content/agreement.ts) */
export default function AgreementPage(): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">用户协议</h1>
      <div className="mt-6">
        <ArticleBody contentMd={null} contentHtml={agreementHtml} />
      </div>
    </section>
  );
}

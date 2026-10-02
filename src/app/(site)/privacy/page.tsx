import type { Metadata } from "next";

import ArticleBody from "@/components/article/ArticleBody";
import { privacyHtml } from "@/content/privacy";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "一起AI网站隐私政策,含自建访问统计的采集与匿名化说明。",
  alternates: { canonical: "/privacy/" },
};

/** 隐私政策(迁移旧文本 + 统计采集说明,requirement §3.5 约束) */
export default function PrivacyPage(): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">隐私政策</h1>
      <div className="mt-6">
        <ArticleBody contentMd={null} contentHtml={privacyHtml} />
      </div>
    </section>
  );
}

/**
 * Agent 搜索结果页(K1 改版,arch/04 §3.1 页面式首搜;原型 site-search.html):
 * 分组命中(资讯/教程/项目,mark 高亮 + 命中度)即时 SSR——URL 可分享/可回退,
 * 命中是真实 HTML;AI 答案卡为流式增强(K2 批③ 挂载),不阻塞命中呈现。
 * 动态 SSR 每请求查询(arch/07-frontend §1);noindex;q 100 字截断;无分页
 * (三组同页纵排限量,组头计数为库内全命中数,深挖经 g-more 进各列表页)。
 */
import type { Metadata } from "next";

import AgentDrawer from "@/components/site/agent/AgentDrawer";
import AnswerCard from "@/components/site/search/AnswerCard";
import GenTime from "@/components/site/search/GenTime";
import SearchConsole from "@/components/site/search/SearchConsole";
import SearchEmpty from "@/components/site/search/SearchEmpty";
import SearchHits from "@/components/site/search/SearchHits";
import { searchAll } from "@/lib/search/unified-search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent 搜索",
  robots: { index: false },
};

function parseQ(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, 100);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.ReactElement> {
  const { q: rawQ } = await searchParams;
  const q = parseQ(rawQ);
  const result = q.length > 0 ? await searchAll(q) : null;

  return (
    <section className="mx-auto w-full max-w-[780px]">
      <SearchConsole q={q} />
      {result ? (
        <>
          {result.total > 0 ? (
            <>
              <div className="mb-[18px] mt-9 border-b border-line pb-3 font-mono text-[13px] text-text-2">
                $ agent.ask &quot;{result.q}&quot; --scope=site → 检索{" "}
                <b className="text-green-hi">{result.total}</b> 条 · <GenTime />
                <span className="text-text-3">(全文 + 摘要混合检索 · 含短视频解读)</span>
              </div>
              {/* K2 答案卡:流式增强,unavailable/未绑定整体不渲染 */}
              <AnswerCard q={q} />
              <SearchHits groups={result.groups} terms={result.terms} />
            </>
          ) : (
            // 零命中:空态头 + 虚线框;答案卡仍出「AI 直接作答」卡(需求红线)
            <>
              <AnswerCard q={q} />
              <SearchEmpty q={result.q} />
            </>
          )}
        </>
      ) : null}
      {/* K2.5 Drawer:搜索场景深挖会话;chips/「继续深挖」经 search:agent-ask 唤起 */}
      <AgentDrawer />
    </section>
  );
}

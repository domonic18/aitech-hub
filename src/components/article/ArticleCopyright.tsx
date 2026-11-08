import { getPostCopyrightMd } from "@/lib/config/site-config";

/**
 * 文末版权声明(2026-11-01 阅读页优化,后台「站点设置 · 文章页」可配):
 * 旧站文章尾部的全站声明未随迁移入库,新站以 site_config kv 承接,缺行回退
 * 内置默认文案(见 lib/config/site-config DEFAULT_POST_COPYRIGHT_MD)。
 * 纯文本渲染 + `whitespace-pre-line` 保留换行;不引第二条 markdown 渲染链。
 * 存空串 = 站长主动关闭,整块不渲染。
 */
export default async function ArticleCopyright(): Promise<React.ReactElement | null> {
  const text = await getPostCopyrightMd();
  if (!text) return null;
  return (
    <section
      aria-label="版权声明"
      className="rounded-md border border-line bg-panel-2 px-4 py-3 text-xs leading-relaxed text-text-3"
    >
      <p className="mb-1 font-semibold text-text-2">版权声明</p>
      <p className="whitespace-pre-line">{text}</p>
    </section>
  );
}

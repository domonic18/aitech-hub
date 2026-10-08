import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/**
 * 正文双模式渲染(arch/07-frontend §8):
 *  - content_md(新文):react-markdown + GFM + 代码高亮;
 *  - content_html(154 篇迁移旧文):入库前已经白名单清洗(清洗规则见 src/lib/content/clean-html.ts),
 *    前端不二次清洗,dangerouslySetInnerHTML + prose.css 兜底排版。
 */
export default function ArticleBody({
  contentMd,
  contentHtml,
}: {
  contentMd: string | null;
  contentHtml: string | null;
}): React.ReactElement | null {
  if (contentMd) {
    return (
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {contentMd}
        </ReactMarkdown>
      </div>
    );
  }
  if (contentHtml) {
    return <div className="prose" dangerouslySetInnerHTML={{ __html: contentHtml }} />;
  }
  return null;
}

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * 正文 HTML 白名单(2026-10-16 反馈问题四:写作技能产出的结构化笔记卡为
 * 内联样式 HTML,rehype-raw 解析透传,rehype-sanitize 收口安全面):GitHub
 * 默认 schema 之上补 section 标签与全元素 style 属性(笔记卡配色/排版全靠
 * 内联样式);script/iframe/事件属性(on*)不在白名单天然全拒。正文产出面是
 * 管理员经技能指南约束的 agent,且公众号渲染链(wechat-html)本就原样透传,
 * 两链信任口径一致。
 */
const htmlNoteSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), "section"])],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style"],
  },
};

/**
 * 正文双模式渲染(arch/07-frontend §8):
 *  - content_md(新文):react-markdown + GFM + 代码高亮 + 原生 HTML 白名单透传
 *    (顺序敏感:raw 解析 → 高亮 → 白名单清洗收尾);
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
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, htmlNoteSchema]]}
          components={{
            // 图文混排(M27 批⑥):正文图惰性加载,首屏 LCP 不被文中小图拖累;
            // 圆角/最大宽度由 prose.css .prose img 既有规则覆盖
            img: (props) => <img loading="lazy" decoding="async" {...props} />,
          }}
        >
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

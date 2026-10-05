/**
 * hero 品牌语行(2026-10-05 性能批次):后台可配 markdown(home.hero_md)的
 * 渲染从 client 的 HeroConsole 移到本服务端组件,经 children 下传——
 * react-markdown/remark-gfm/micromark 管线(~44KB gzip)不再进首页首屏 JS
 * (文章页 ArticleBody/项目页 RepoReadme 仍正当持有该管线,不受影响)。
 * 行内语法白名单与原 HeroMarkdown 一致:块级全部 disallow + unwrap,
 * 链接/行内代码给终端风样式;空配置回退内置品牌语(SEO h1 落点不变)。
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 内置品牌语(hero_md 空/缺省时的 h1 文本) */
export const HERO_FALLBACK = "# AI 信息 Hub — 资讯 · 教程 · 项目,连接人与快速变化的 AI";

export default function HeroBrandLine({ heroMd }: { heroMd?: string }): React.ReactElement {
  if (!heroMd) {
    return <>{HERO_FALLBACK}</>;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={[
        "p",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "hr",
        "img",
      ]}
      unwrapDisallowed
      components={{
        a: (props) => (
          <a
            href={props.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            {props.children}
          </a>
        ),
        code: (props) => (
          <code className="rounded bg-panel-2 px-1 font-mono text-[12.5px] text-accent-hi">
            {props.children}
          </code>
        ),
      }}
    >
      {heroMd}
    </ReactMarkdown>
  );
}

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/**
 * README 渲染(M11 批④):独立组件、不碰 ArticleBody——154 篇文章正文渲染
 * 关键路径零改动(arch/07-frontend §8 注)。react-markdown 默认不渲染裸 HTML
 * (不开 rehype-raw,GitHub README 内嵌的 HTML 片段安全丢弃);
 *  - 相对图片 → `raw.githubusercontent.com/{fullName}/{defaultBranch}/…`(README 常规取图位);
 *  - 相对链接 → `github.com/{fullName}/blob/{defaultBranch}/…`(避免落进本站路由);
 *  - 绝对 http(s) 与页内锚点透传;外链一律 _blank + nofollow,图片 lazy + no-referrer。
 */

function toRawImageSrc(src: string, fullName: string, branch: string): string {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return src;
  }
  const rel = src.replace(/^\.\//, "").replace(/^\//, "");
  return `https://raw.githubusercontent.com/${fullName}/${branch}/${rel}`;
}

function toBlobHref(href: string, fullName: string, branch: string): string {
  if (/^(https?:)?\/\//i.test(href) || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return href;
  }
  const rel = href.replace(/^\.\//, "").replace(/^\//, "");
  return `https://github.com/${fullName}/blob/${branch}/${rel}`;
}

export default function RepoReadme({
  readmeMd,
  fullName,
  defaultBranch,
}: {
  readmeMd: string | null;
  fullName: string;
  defaultBranch: string;
}): React.ReactElement | null {
  if (!readmeMd) return null;
  const components: Components = {
    a: ({ children, href, title }) => {
      const final = href ? toBlobHref(href, fullName, defaultBranch) : undefined;
      return (
        <a href={final} title={title} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    },
    img: ({ alt, src, title }) => {
      const raw = typeof src === "string" ? src : "";
      return (
        // eslint-disable-next-line @next/next/no-img-element -- GitHub 原址直出,Nginx/CDN 域不走 next/image 优化器(同 arch/07-frontend §3 口径)
        <img
          src={toRawImageSrc(raw, fullName, defaultBranch)}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    },
  };
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {readmeMd}
      </ReactMarkdown>
    </div>
  );
}

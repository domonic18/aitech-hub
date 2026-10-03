import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** 旧 URL 全部带尾斜杠,canonical 一致(arch/07-frontend §3 红线 1,始终开启) */
  trailingSlash: true,
  /** Docker 单镜像部署(standard/02-cicd-deployment §3) */
  output: "standalone",
  async redirects() {
    return [
      // WP 时代订阅地址承接(standard/02 §5 验收清单):/feed 与 /feed/ → /feed.xml
      // trailingSlash 规范化先于 redirects 执行,canonical 形态 /feed/ 必须显式列出
      { source: "/feed", destination: "/feed.xml", statusCode: 301 },
      { source: "/feed/", destination: "/feed.xml", statusCode: 301 },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        // 文章 .md 直出(GEO,requirement §3.2):/<slug>.md → /md/<slug>
        { source: "/:slug*.md", destination: "/md/:slug*" },
        // llms-full 分片对外 URL 带宽;/llms-full-2.txt → /llms-full.txt/2
        { source: "/llms-full-:part.txt", destination: "/llms-full.txt/:part" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;

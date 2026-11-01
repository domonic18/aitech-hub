import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** 旧 URL 全部带尾斜杠,canonical 一致(arch/07-frontend §3 红线 1,始终开启) */
  trailingSlash: true,
  /** Docker 单镜像部署(standard/02-cicd-deployment §3) */
  output: "standalone",
  async redirects() {
    return [
      // IA v5 板定(2026-10-23):数据中心收敛为采集执行域(源管理/计划/运行),
      // 洞察拆独立域 /admin/insight,挖掘拆入源管理/洞察。带 query 的精确分流
      // 在前(has 条件;其余 query 如 kw/page 原样透传),具体优先于泛化;
      // 双斜杠形态都列(防双跳,trailingSlash 规范化先于 redirects)
      {
        source: "/admin/data/insight/clusters/:path*",
        destination: "/admin/insight/clusters/:path*",
        statusCode: 308,
      },
      {
        source: "/admin/data/insight/clusters/",
        destination: "/admin/insight/clusters/",
        statusCode: 308,
      },
      { source: "/admin/data/insight", destination: "/admin/insight/", statusCode: 308 },
      { source: "/admin/data/insight/", destination: "/admin/insight/", statusCode: 308 },
      // mine 按 query 分流必须在裸规则之前:裸 source 能先匹配截胡(has 不再评估)
      {
        source: "/admin/data/mine/",
        has: [{ type: "query", key: "t", value: "^(bloggers)$" }],
        destination: "/admin/data/sources/?t=bloggers",
        statusCode: 308,
      },
      {
        source: "/admin/data/mine/",
        has: [{ type: "query", key: "t", value: "^(candidates)$" }],
        destination: "/admin/data/sources/?t=candidates",
        statusCode: 308,
      },
      {
        source: "/admin/data/mine/",
        has: [{ type: "query", key: "t", value: "^(github)$" }],
        destination: "/admin/insight/discovery/?t=github",
        statusCode: 308,
      },
      {
        source: "/admin/data/mine",
        destination: "/admin/data/sources/?t=candidates",
        statusCode: 308,
      },
      {
        source: "/admin/data/mine/",
        destination: "/admin/data/sources/?t=candidates",
        statusCode: 308,
      },
      {
        source: "/admin/data/sources/",
        has: [{ type: "query", key: "t", value: "^(words)$" }],
        destination: "/admin/insight/discovery/?t=words",
        statusCode: 308,
      },
      {
        source: "/admin/data/sources/",
        has: [{ type: "query", key: "t", value: "^(hot)$" }],
        destination: "/admin/data/sources/?t=channels",
        statusCode: 308,
      },
      {
        source: "/admin/data/run/",
        has: [{ type: "query", key: "t", value: "^(plan)$" }],
        destination: "/admin/data/plan/",
        statusCode: 308,
      },
      // M42 创作中心(2026-10-22):专题管理 → 创作中心,旧书签/外链 308 承接
      { source: "/admin/topics", destination: "/admin/studio/", statusCode: 308 },
      { source: "/admin/topics/", destination: "/admin/studio/", statusCode: 308 },
      { source: "/admin/topics/:path*", destination: "/admin/studio/:path*", statusCode: 308 },
      // WP 时代订阅地址承接(standard/02 §5 验收清单):/feed 与 /feed/ → /feed.xml
      // trailingSlash 规范化先于 redirects 执行,canonical 形态 /feed/ 必须显式列出
      { source: "/feed", destination: "/feed.xml", statusCode: 301 },
      { source: "/feed/", destination: "/feed.xml", statusCode: 301 },
      // 侧栏精简批①(2026-10-14):配置类页并入 /admin/settings 壳、渠道并入
      // /admin/spider 壳,旧路径书签 308 承接(两种斜杠形态都列,防双跳)
      { source: "/admin/email", destination: "/admin/settings/email/", statusCode: 308 },
      { source: "/admin/email/", destination: "/admin/settings/email/", statusCode: 308 },
      { source: "/admin/feishu", destination: "/admin/settings/feishu/", statusCode: 308 },
      { source: "/admin/feishu/", destination: "/admin/settings/feishu/", statusCode: 308 },
      { source: "/admin/pay", destination: "/admin/settings/pay/", statusCode: 308 },
      { source: "/admin/pay/", destination: "/admin/settings/pay/", statusCode: 308 },
      { source: "/admin/pats", destination: "/admin/settings/pats/", statusCode: 308 },
      { source: "/admin/pats/", destination: "/admin/settings/pats/", statusCode: 308 },
      {
        source: "/admin/channels",
        destination: "/admin/data/sources/?t=channels",
        statusCode: 308,
      },
      {
        source: "/admin/channels/",
        destination: "/admin/data/sources/?t=channels",
        statusCode: 308,
      },
      // 侧栏精简批②(2026-10-14):博主/项目并入发现壳、会话并入 /admin/usage 壳
      // (IA v5 后目标随新域更新:博主→源管理·博主台账,项目→洞察·项目发现)
      {
        source: "/admin/bloggers",
        destination: "/admin/data/sources/?t=bloggers",
        statusCode: 308,
      },
      {
        source: "/admin/bloggers/",
        destination: "/admin/data/sources/?t=bloggers",
        statusCode: 308,
      },
      {
        source: "/admin/github",
        destination: "/admin/insight/discovery/?t=github",
        statusCode: 308,
      },
      {
        source: "/admin/github/",
        destination: "/admin/insight/discovery/?t=github",
        statusCode: 308,
      },
      {
        source: "/admin/agent-sessions",
        destination: "/admin/usage/sessions/",
        statusCode: 308,
      },
      {
        source: "/admin/agent-sessions/",
        destination: "/admin/usage/sessions/",
        statusCode: 308,
      },
      // 数据壳重组·方案二(2026-10-18)→ IA v5 修订(2026-10-23):旧 /admin/insight
      // 现为真实路由(洞察独立域),不再 redirect;采集/发现旧壳路径映射新域子段
      {
        source: "/admin/spider/channels",
        destination: "/admin/data/sources/?t=channels",
        statusCode: 308,
      },
      {
        source: "/admin/spider/channels/",
        destination: "/admin/data/sources/?t=channels",
        statusCode: 308,
      },
      { source: "/admin/spider/schedule", destination: "/admin/data/plan/", statusCode: 308 },
      { source: "/admin/spider/schedule/", destination: "/admin/data/plan/", statusCode: 308 },
      { source: "/admin/spider", destination: "/admin/data/run/", statusCode: 308 },
      { source: "/admin/spider/", destination: "/admin/data/run/", statusCode: 308 },
      {
        source: "/admin/discovery/bloggers",
        destination: "/admin/data/sources/?t=bloggers",
        statusCode: 308,
      },
      {
        source: "/admin/discovery/bloggers/",
        destination: "/admin/data/sources/?t=bloggers",
        statusCode: 308,
      },
      {
        source: "/admin/discovery/github",
        destination: "/admin/insight/discovery/?t=github",
        statusCode: 308,
      },
      {
        source: "/admin/discovery/github/",
        destination: "/admin/insight/discovery/?t=github",
        statusCode: 308,
      },
      { source: "/admin/discovery", destination: "/admin/insight/discovery/", statusCode: 308 },
      { source: "/admin/discovery/", destination: "/admin/insight/discovery/", statusCode: 308 },
      // M66(2026-11-01):公众号接入配置收口到系统设置壳,旧书签 308 承接
      // (两种斜杠形态都列,防双跳)
      {
        source: "/admin/wechat-mp/config",
        destination: "/admin/settings/wechat-mp/",
        statusCode: 308,
      },
      {
        source: "/admin/wechat-mp/config/",
        destination: "/admin/settings/wechat-mp/",
        statusCode: 308,
      },
    ];
  },
  async headers() {
    return [
      // 电报流 noindex 双保险之一(页内另有 robots meta;arch/07 §2 /telegram)
      { source: "/telegram", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] },
      { source: "/telegram/", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] },
      { source: "/telegram/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        // 文章 .md 直出(GEO,requirement §3.2;2026-10 URL 终态):/post/<id>-<slug>.md → /md/post/<id>-<slug>
        { source: "/post/:seg.md", destination: "/md/post/:seg" },
        // 旧单段 .md(llms.txt 早期分发形态):/<slug>.md → /md/<slug>(经映射表 301 到新形态)
        { source: "/:slug*.md", destination: "/md/:slug*" },
        // llms-full 分片对外 URL 带宽;/llms-full-2.txt → /llms-full.txt/2
        { source: "/llms-full-:part.txt", destination: "/llms-full.txt/:part" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;

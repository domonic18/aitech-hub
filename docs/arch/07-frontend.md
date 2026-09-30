# 前端与 API 层设计(src/app/)

> Next.js 15 App Router 单体:公开站 RSC/ISR 承载 SEO,`src/app/api/` Route Handlers 承载客户端交互与外部回调,两者同仓同进程。业务库层见 [05-services.md](05-services.md)。

## 1. 渲染策略(按路由)

| 路由 | 策略 | 说明 |
|------|------|------|
| `/`(首页) | ISR 600s | 最新/精选文章 |
| `/[slug]`(文章详情) | ISR + 按需 revalidate | 154 篇构建期全量预渲染;后台保存文章后由 post service 直调 `revalidatePath` |
| `/articles`、`/category/[slug]`、`/tag/[slug]`、`/archive` | ISR 600s | 列表族 |
| `/search` | 动态 SSR | 每请求查询 |
| `/about`、`/agreement`、`/privacy` | 静态 | |
| `/(user)/**`(登录/账号) | CSR | 无 SEO 诉求 |
| `/admin/**` | CSR + 客户端守卫 | AntD;API 层二次鉴权 |
| `src/app/api/**` | Route Handlers | 不参与渲染;`dynamic = 'force-dynamic'` |
| `sitemap.ts`、`robots.ts`、`feed.xml` | Metadata Route / Route Handler | 动态生成,缓存 1h |

- **按需失效**:文章保存(publish/update)→ post service 内直接 `revalidatePath('/<slug>')` + 列表页 + 首页 + sitemap——单体红利,无需 HTTP 内部调用
- RSC 数据获取**直查 Prisma**(经 `lib/content/` service 层),禁止页面内 fetch 自己的 `/api`

## 2. 中文编码 slug 路由(红线,范例项目式"事故条款")

旧站 URL 形如 `https://17aitech.com/%e3%80%90%e5%b7%a5%e5%85%b7%e6%8a%80%e5%b7%a7%e3%80%91.../`,DB `slug` 列存的就是 **percent-encoded 原文**。App Router 的 `params.slug` 是 **URL-decode 后的中文**。因此:

1. **`trailingSlash: true` 必须始终开启**(旧 URL 全部带尾斜杠,canonical 一致)
2. 唯一匹配入口 `src/lib/slug.ts` 的 `normalizeSlug(raw: string): string`:
   - 输入可能是解码后的中文(`【工具技巧】...`)或编码形态(`%e3%80%90...`),统一归一化为**编码形态**再查库
   - 实现:`decodeURIComponent` 幂等包裹(try/catch 已编码串)+ `encodeURIComponent` 输出;处理 `%` 二次编码边界
3. 文章页、tag 页、legacy 兜底、迁移脚本——**凡查 slug 一律经 `normalizeSlug`,禁止直接拿 params 查库**
4. `normalizeSlug` 必须有单测钉死:编码↔解码往返、`%` 字面量、`+`/空格边界(此函数坏了 = 全站文章 404)
5. `generateStaticParams` 返回 DB 原始 `slug`(编码形态);构建后抽 10 篇中文 URL 做产物断言(e2e)

## 3. SEO 实现清单

- `app/layout.tsx`:默认 metadata(template `%s | 一起AI技术`),`metadataBase = NEXT_PUBLIC_SITE_URL`
- 文章页 `generateMetadata`:title=seo_title||title,description=seo_description||excerpt,canonical=`/<slug>/`,OG(article + cover + published_time)
- 文章页 JSON-LD:`Article`(headline/datePublished/dateModified/author=Person domonic18/mainEntityOfPage)
- `sitemap.ts`:全部 published 文章 + 分类 + 标签 + 静态页,`lastModified` 取 updated_at
- `feed.xml`:RSS 2.0 最新 20 篇(旧 `/feed/` 由 Nginx 301 接入)
- `robots.ts`:允许全部,`Sitemap` 指向本站;`/admin`、`/api` disallow
- `llms.txt` / `llms-full.txt`(2026-09-29 战略定稿,智能体可见性):前者 = 站点结构 AI 目录(标题 + 链接 + 一句话摘要,分节同 sitemap);后者 = 全量文章 content_md 拼合(超长则分页 `llms-full-N.txt`);Route Handler 动态生成 + ISR 缓存,策略同 sitemap。**实现注**:分片对外 URL 为 `/llms-full-N.txt`,经 next.config rewrite 转 `/llms-full.txt/[part]` 路由(.md rewrite 同理,已实测与 trailingSlash 共存)
- 文章 `.md` 直出:`GET /<slug>.md`(与 `/<slug>/` 同语义),`Content-Type: text/markdown`,输出 content_md,为 NULL 时(154 篇迁移文均如此)以 `htmlToMarkdown(content_html)` 兜底转换;同 ISR 缓存;不为 AI 爬虫设 disallow(robots 默认全允许已覆盖)
- 图片:`/wp-content/**` 由 Nginx 直接服务,**不走 next/image 优化器**(文件不在 Next 侧,optimizer 会 404)——正文用原生 `<img loading="lazy">`(迁移清洗时统一补),封面 `next/image` + `unoptimized`;Nginx 对该前缀 immutable 长缓存。**本地兜底(实现注)**:`app/wp-content/[...path]/route.ts` 读 `MEDIA_DIR`(默认 `workspace/media/`;生产容器由 compose x-app-env 钉为 `/app/media`)直出文件;catch-all params 不含 `wp-content` 前缀,磁盘文件名保持 percent-encoded 形态,params 已解码,须经 `normalizeUrlPath` 重编码后读盘(媒体零改写原则,arch/08-media)
- 字体:中文走系统字体栈,不加载大 webfont;拉丁/代码 next/font(local) 子集

## 4. API 层约定(src/app/api/)

- 风格:REST,camelCase JSON;响应包络 `{ code, message, data }`,列表 `{ items, total, page, pageSize }`
- 输入校验:Zod schema(`src/lib/*/schemas.ts`,与类型同源 `z.infer`);错误 → 400 带明细
- 状态码:400/401/403/404/409/429/500 语义化;统一错误包络
- **mutation 类 Handler 必须做 Origin/Host 校验**(同源才放行)——Route Handlers 没有 Server Actions 的内建 CSRF 防护,这步是补位
- 会话:读 httpOnly Cookie(arch/05-services §3),`getSessionUser()` helper;admin 端点一律叠加 `requireAdmin()`
- 分页:`page`/`pageSize` + Zod 范围校验,默认值 `lib/constants.ts`
- 涉及上传:`POST /api/media` 走 `request.formData()`,图片限 10MB、类型白名单;**视频不走此通道**(STS 直传 COS,arch/08-media)

## 5. 客户端数据获取

- `lib/api-client.ts`:fetch 封装,响应过 Zod 校验;401 自动尝试续期(刷新会话)后重放一次
- TanStack Query 管理客户端缓存(admin 列表、用户资料);Zustand 只放 session(当前用户)
- RSC 组件直查 service 层;客户端组件才走 api-client——两条路径边界写进 CLAUDE.md

## 6. 旧 URL 承接(legacy 兜底路由)

`app/(site)/legacy/[...path]/route.ts`:

1. 入参经 `normalizeSlug` 还原完整路径,查 `legacy_url_map`(Redis 缓存 1h,miss 落库一次防穿透)
2. 命中 → `NextResponse.redirect(target, status)`;`target_url` 为 NULL → 410;未命中 → `notFound()`
3. Nginx 把新站未命中路由兜底转发到 `/legacy/<path>`(standard/02-cicd-deployment §4),即"先新站路由、后映射表"
4. **双层兜底(实现注)**:`/[slug]`、`/category/[slug]`、`/tag/[slug]` 页面查无内容时同进程直查映射表(`lib/content/legacy.ts#legacyRedirectOrNotFound`),命中则 `permanentRedirect`——RSC 页面语境拿不到精确 301(固定 308,同为永久类),表内 `http_status` 的精确表达由本 route 层完成;E2E 断言精确 301 须打 `/legacy/<path>`

## 7. 管理后台(/admin)

- AntD 5 侧边栏布局;`AdminGuard` 客户端守卫(session.role==='admin',否则跳 /login);API 层 `requireAdmin()` 双重防护
- 文章编辑器:**Markdown 主编辑区 + 实时预览**(`@uiw/react-md-editor` 或等价轻量方案);元信息表单:标题(自动生成 slug)、分类、标签多选、封面、SEO 字段、发布
- **一键发文(2026-09-29 需求,一期交付)**:
  - Markdown 导入:「导入 .md / 粘贴」→ 解析全部图片引用 → 弹窗批量上传本地图片(选择文件夹/拖拽/zip,sha1 去重)+ 外链图调 `POST /api/media/import` 转存 → 以返回映射自动替换 md 中的引用为站内 URL → 进编辑器;编辑器内截图粘贴直接走上传管线
  - 封面工作流:本地上传/媒体库选用 + 内置裁剪器(react-easy-crop 等价方案),预设模板微信 2.35:1 / OG 1200×630 / CSDN 16:9,一次裁剪多尺寸导出(前端 canvas 裁剪 + 压缩后按 `cover` 变体上传);AI 文生图按钮一期置灰,二期点亮(混元生图)
- 编辑旧文:content_html 只读展示(提示"旧文保真,如需改写请转 Markdown 重发布"),避免双向转换损毁
- **媒体库页(重点,详见 arch/08-media)**:图片/视频/文件 Tab + 引用状态过滤(已引用/未引用孤儿/断链)+ 重复检测 + 批量操作 + 存储统计
- 用户/数据页:AntD Table + 服务端分页

## 8. 组件与样式

- components 按 domain 分包:`site/`(Header/Footer/分页)、`article/`(卡片/正文渲染器/VideoPlayer)、`auth/`、`admin/`、`media/`
- 正文渲染器 `ArticleBody`:content_md 走 react-markdown(+ rehype-highlight);content_html 走 `dangerouslySetInnerHTML`(入库前已清洗,前端不二次清洗)+ `styles/prose.css` 兜底
- VideoPlayer 双模式:COS MP4(`<video>` 原生)/ B 站 iframe 嵌入(arch/08-media §2)

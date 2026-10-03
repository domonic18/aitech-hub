# 前端与 API 层设计(src/app/)

> Next.js 15 App Router 单体:公开站 RSC/ISR 承载 SEO,`src/app/api/` Route Handlers 承载客户端交互与外部回调,两者同仓同进程。业务库层见 [05-services.md](05-services.md)。

## 1. 渲染策略(按路由)

| 路由 | 策略 | 说明 |
|------|------|------|
| `/`(首页) | ISR 600s | 最新/精选文章 |
| `/post/[slug]`(文章详情,`<slug>`=`<id>-<ascii>` 段) | ISR + 按需 revalidate | 构建期全量预渲染 canonical 段;后台保存文章后由 post service 直调 `revalidatePath` |
| `/[slug]`(旧中文链承接) | ISR 600s | 纯 legacy 引擎:查 `legacy_url_map` 命中 → 308,否则 404(不再直接供文) |
| `/articles`、`/category/[slug]`、`/tag/[slug]`、`/archive` | ISR 600s | 列表族 |
| `/search` | 动态 SSR | 每请求查询 |
| `/about`、`/agreement`、`/privacy` | 静态 | |
| `/(user)/**`(登录/账号) | CSR | 无 SEO 诉求 |
| `/admin/**` | CSR + 客户端守卫 | AntD;API 层二次鉴权 |
| `src/app/api/**` | Route Handlers | 不参与渲染;`dynamic = 'force-dynamic'` |
| `sitemap.ts`、`robots.ts`、`feed.xml` | Metadata Route / Route Handler | 动态生成,缓存 1h |

- **按需失效**:文章保存(publish/update)→ post service 内直接 `revalidatePostPaths({id, slug})`(详情 + `.md` + 列表族 + sitemap,见 `lib/content/revalidate.ts`)——单体红利,无需 HTTP 内部调用
- RSC 数据获取**直查 Prisma**(经 `lib/content/` service 层),禁止页面内 fetch 自己的 `/api`

## 2. 文章 URL 终态:/post/&lt;id&gt;-&lt;slug&gt;(2026-10 迁移,红线)

**历史**:旧站(WordPress)URL 为中文 percent-encoded 单段(`/%e3%80%90.../`),2026-06 切换初期原样保留;2026-10-03 起全站迁移到 id 锚定混合形态,旧链经 `legacy_url_map` 301/410 承接(103×301 + 53×410,见 migration `20261003190000_post_id_url`)。

**终态规则**(`src/lib/content/post-path.ts` 是唯一构造/解析出口):

1. 文章详情 URL = `/post/<id>-<ascii-slug>/`;`id`(BigInt)是**唯一解析锚**,slug 是纯装饰(可空、可随时改,改名不破链)
2. 纯中文标题派生不出 ASCII token → slug 为 NULL,canonical 为 bare-id `/post/<id>/`
3. **canonical 归一**:`/post/[slug]` 页解析段后与 canonical 段对比,不一致一律 `permanentRedirect`(308)到唯一 canonical——bare-id、错误尾巴、旧装饰 slug 都收敛到同一地址
4. **`trailingSlash: true` 必须始终开启**(新旧 URL 全部带尾斜杠,canonical 一致;legacy 301 目标须带尾斜杠,避免二次归一跳)
5. ASCII slug 派生:`asciiSlugFromTitle`——标题取 `[a-z0-9]+` token 小写连字符连接、连续重复 token 去重、80 字符 token 边界截断、零 token → NULL;冲突自动 `-2..-9` 后缀(`posts-admin.createPost`)
6. 解析容错:`parsePostSegment` 按**前导数字段**取 id、尾巴整段容忍(`/<id>-<任意>/` 都能解析到 id 再 canonical 归一),禁止直接拿 params 查库
7. 分类/标签/legacy 兜底仍走 `src/lib/slug.ts#normalizeSlug`(percent-encoded 中文,与文章 URL 无关):输入可能是解码中文或编码形态,统一归一化为编码形态再查库;`normalizeSlug` 单测钉死编码↔解码往返、`%` 字面量、`+`/空格边界
8. `generateStaticParams` 只返回 canonical 段(`listPostSegmentsForPrerender`);e2e 冒烟断言:canonical 200、bare-id/错误尾巴 308、旧中文链单跳 301/308 到 `/post/`、410 行 404

## 3. SEO 实现清单

- `app/layout.tsx`:默认 metadata(template `%s | 一起AI`;品牌 2026-10-02 定稿,src 已同批落地:Header 17 monogram 芯片 + icon.svg),`metadataBase = NEXT_PUBLIC_SITE_URL`
- 文章页 `generateMetadata`:title=seo_title||title,description=seo_description||excerpt,canonical=`/post/<id>-<slug>/`(post-path 构造),OG(article + cover + published_time)
- 文章页 JSON-LD:`Article`(headline/datePublished/dateModified/author=Person domonic18/mainEntityOfPage)
- `sitemap.ts`:全部 published 文章 + 分类 + 标签 + 静态页,`lastModified` 取 updated_at
- `feed.xml`:RSS 2.0 最新 20 篇(旧 `/feed/` 由 Nginx 301 接入)
- `robots.ts`:允许全部,`Sitemap` 指向本站;`/admin`、`/api` disallow
- `llms.txt` / `llms-full.txt`(2026-09-29 战略定稿,智能体可见性):前者 = 站点结构 AI 目录(标题 + 链接 + 一句话摘要,分节同 sitemap);后者 = 全量文章 content_md 拼合(超长则分页 `llms-full-N.txt`);Route Handler 动态生成 + ISR 缓存,策略同 sitemap。**实现注**:分片对外 URL 为 `/llms-full-N.txt`,经 next.config rewrite 转 `/llms-full.txt/[part]` 路由(.md rewrite 同理,已实测与 trailingSlash 共存)
- 文章 `.md` 直出:`GET /post/<id>-<slug>.md`(与 `/post/<id>-<slug>/` 同语义,next.config rewrite → `/md/post/<seg>` 路由),`Content-Type: text/markdown`,输出 content_md,为 NULL 时(154 篇迁移文均如此)以 `htmlToMarkdown(content_html)` 兜底转换;同 ISR 缓存;旧单段 `/<slug>.md` 经映射表 301 到新形态 `.md`;不为 AI 爬虫设 disallow(robots 默认全允许已覆盖)
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
4. **双层兜底(实现注)**:`/category/[slug]`、`/tag/[slug]` 页面查无内容时同进程直查映射表(`lib/content/legacy.ts#legacyRedirectOrNotFound`),命中则 `permanentRedirect`——RSC 页面语境拿不到精确 301(固定 308,同为永久类),表内 `http_status` 的精确表达由本 route 层完成;E2E 断言精确 301 须打 `/legacy/<path>`
5. **2026-10 URL 迁移行**:`legacy_url_map` 增 103×301(旧中文单段链 → `/post/<id>-<slug>/`,目标带尾斜杠单跳直达)与 53×410(下架删除文);`/[slug]` 页自迁移起为纯 legacy 引擎(不再直接供文,见 §1);Redis `legacy:map:*` 缓存 1h——**部署后须 flush 该前缀**,否则旧行(404/旧目标)最长多活 1h

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

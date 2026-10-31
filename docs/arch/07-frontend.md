# 前端与 API 层设计(src/app/)

> Next.js 15 App Router 单体:公开站 RSC/ISR 承载 SEO,`src/app/api/` Route Handlers 承载客户端交互与外部回调,两者同仓同进程。业务库层见 [05-services.md](05-services.md)。

## 1. 渲染策略(按路由)

| 路由 | 策略 | 说明 |
|------|------|------|
| `/`(首页) | ISR 600s | 最新/精选文章 + 电报流 LIVE 带(M7 批⑤:SSR 首屏,岛内 60s 轮询;M10 批②:条数后台可配 `site_config.band.item_count` 默认 12,钳 1..50,滚动到底按服务端 `nextOffset` 游标翻页——保底视频只占展示位不占游标,被替换项由后续页补达;客户端 id 去重防轮询前插与翻页追加打架;保存条数即 `revalidatePath("/", "layout")`;M12 批②:项目/文章 rail 条数 `home.repo_count` 默认 3、`home.post_count` 默认 5(均钳 1..12)、站名 `site.title` 与 hub 主文案 `home.hero_md`(行内 markdown,空回退内置)同键族后台可配,站名传播 generateMetadata/Header/Footer/feed.xml/llms.txt) |
| `/post/[slug]`(文章详情,`<slug>`=`<id>-<ascii>` 段) | ISR + 按需 revalidate | 构建期全量预渲染 canonical 段;后台保存文章后由 post service 直调 `revalidatePath`;M23:评论区(`PostComments`)+ 点赞(`PostLikeButton`)为 client island——挂载后 fetch `force-dynamic` API 直查(含个人化 liked),**不进 ISR、治理动作零 revalidate**(隐藏/恢复对访客即时收敛) |
| `/[slug]`(旧中文链承接) | ISR 600s | 纯 legacy 引擎:查 `legacy_url_map` 命中 → 308,否则 404(不再直接供文) |
| `/articles`、`/category/[slug]`、`/tag/[slug]`、`/archive` | ISR 600s | 列表族;M12 批①:条目区客户端「列表 ⇄ 封面卡」视图切换(两视图皆服务端渲染、切换纯显隐零二次请求;localStorage `articles-view` 记忆,默认列表——SSR HTML 即列表,SEO/LCP 不受影响;视图记忆是个人偏好不进 URL,可分享的筛选走 /category、/tag 路由)+ /articles 头部 tag 筛选条(chip 链既有 `/tag/<slug>/` 静态路由,零 searchParams 不破 ISR/canonical);M23 延伸:列表卡 meta 行带 评论数/点赞数(列表出口按页内 id groupBy 现查,评论只数 visible,随 ISR 600s 刷新——与详情页实时计数口径差异见 arch/03 决策②) |
| `/projects/`(开源项目列表,M11) | ISR 600s | 白名单展示仓全量卡片(sortOrder→stars),不分页;admin 写侧即时 revalidate,同步新鲜度走本窗口;首页右栏同源 rail 卡(空白名单整卡不渲染) |
| `/projects/[slug]/`(项目详情,M11) | ISR 600s + 按需 revalidate | slug 是唯一解析键(登记时派生此后冻结;**无 id 锚点,错 slug 直接 404 不做 308 归一**,构造唯一出口 `src/lib/github/project-path.ts`);README 渲染 + 进展动态 + 配套文章;下架(display=false)即 404 |
| `/leaderboards/`(AI 榜单,M58 批③;M63 可视化改版) | ISR 3600s | 三节:模型榜(Artificial Analysis 智能指数 × 输出价散点 ∥ Hugging Face 趋势横条,CSS `:checked` 双子页签)/ 论文(arXiv cs.AI·cs.CL 卡片流)/ 热门仓库(GitHub Trending 动量卡:今日上升最快 + 新入榜)。全量行 SSR 直出进 HTML;节间跳转走页内锚点 chips,页签纯 CSS——读 `searchParams` 即转动态渲染破 ISR,故不用 query;名次变动(↑↓/NEW)读时与「上一可用日期」相减,首期采集(`hasPrevious=false`)不标 NEW;AA 入库 ≤60、其余 ≤20(`def.maxItems`);展示字段(价格/上下文/开源/摘要/作者/描述/星分叉)落 `meta` Json 白名单清洗,缺失整项省略;散点价格未采到或样本 <2 时自动退化为完整表 + 补采提示;数据超 2 天出降级横幅,空榜出空态;`ItemList` JSON-LD;组件 `src/components/site/LeaderboardView.tsx` 只做编排,各节在 `src/components/site/leaderboard/`,散点几何纯函数 `src/lib/leaderboard/scatter.ts`(禁图表库,手写 SVG),入口经 `SITE_TOPICS` 专题区。静态路由优先级高于 `(site)/[slug]` legacy catcher |
| `/search` | 动态 SSR | 每请求查询;K1 三域分组 + K2 AI 答案卡(arch/04 §3,2026-10-06 第一迭代):分组命中即时 SSR(mark 高亮 + 渠道 chip + 命中度),答案卡 `AnswerCard` 客户端 **fetch + getReader 手解 SSE**(站内流式消费先例;**禁 EventSource**——自动重连会重复计费)流式增强不阻塞命中;0 命中同样挂答案卡(「AI 直接作答」标注);组件 `src/components/site/search/`:SearchConsole/SearchHits/TelegramHit/PostHit/RepoHit/SearchEmpty/AnswerCard/GenTime;noindex 仅页内 robots meta(不在 middleware `X-Robots-Tag` 名单) |
| `/telegram`(电报流,M7 批⑤) | 动态 SSR(`force-dynamic`)+ 客户端 60s 轮询 | **noindex 双保险**(robots meta + next.config `X-Robots-Tag` 头)且**不入 sitemap**(显式页面清单);渠道筛选 URL 驱动(`?source=`);仅出 AI 解读终态行,空列 + 今日有入库 → 「AI 解读处理中」空态(M15 批①);新讯**即刷即渲染**(同构重排)+ 虚线浮条「↑ N 条新电报」点击平滑回顶重置未读锚(与 ai-invest-assisstant 同款,M15 批③;原「点击载入」缓冲闸门退役) |
| `/about`、`/agreement`、`/privacy` | 静态 | |
| `/(user)/**`(登录/账号) | CSR | 无 SEO 诉求 |
| `/admin/**` | CSR + 客户端守卫 | AntD;API 层二次鉴权 |
| `src/app/api/**` | Route Handlers | 不参与渲染;`dynamic = 'force-dynamic'` |
| `sitemap.ts`、`robots.ts`、`feed.xml` | Metadata Route / Route Handler | 动态生成,缓存 1h |

- **按需失效**:文章保存(publish/update)→ post service 内直接 `revalidatePostPaths({id, slug})`(详情 + `.md` + 列表族 + sitemap,见 `lib/content/revalidate.ts`)——单体红利,无需 HTTP 内部调用。**sitemap/llms.txt 是 Metadata Route / ISR Route Handler,`revalidatePath` 必须用 `"layout"` 型**:默认 `"page"` 型打不中其内部 `_N_T_/<path>/route` 缓存 tag(缓存纹丝不动,2026-10-05 M11 e2e 实证;`"layout"` 型命中的 `_N_T_/<path>/layout` 在其 tag 列表内,即时生效)——发文本就带 sitemap 的一步曾长期只走 1h ISR 兜底
- RSC 数据获取**直查 Prisma**(经 `lib/content/` service 层),禁止页面内 fetch 自己的 `/api`
- **骨架图(loading.tsx)只挂无状态码语义的路由**(2026-10-04 M10 批④,e2e 实证):现仅 `/telegram`、`/search`(动态 SSR,每请求真流式)与 `/articles`、`/archive`(纯 200 列表)四段。段落级 loading 会使首屏 shell 先行 200 冲刷,页内 `permanentRedirect`/`notFound()` 退化为软跳转/软 404——`/post/[id]-[slug]` 308 归一与 category/tag 404 是 SEO 红线,故不挂(三者为 ISR 缓存热读,生产近秒开,骨架收益本就趋零);admin 段 loading 与 `router.refresh()` 互卡致变更后内容不出,同样不挂。基元/组合件见 `src/components/Skeleton.tsx` 头注
- **相对时间的水合契约(2026-10-04 实修)**:首页带与 `/telegram` 时间线的 `timeAgo`/`NEW`/日分组标签以**服务端下发的 `initialNow` prop** 为基准(props 经 RSC 序列化,SSR 与水合必然一致),水合后 60s 轮询才切客户端时钟。组件内自取 `Date.now()` 会在 SSR/水合时差下产出不同相对时间文本 → React #418 整树水合回退——回退重渲染会把预置脚本设置的 `html[data-theme]` 重灌回 light(用户实测「页面自动变 Light、切换后刷新复原」即此链)
- **电报流 M15 交互契约(2026-10-06)**:公开读侧仅出 AI 解读终态行(done/missing_transcript),`PublicTelegramItem.aiRanAt`(解读完成=变可见时刻)入契约——前台增量轮询 after 锚与 NEW 角标基准(30min 窗)都锚它,展示排序/相对时间仍按 `publishedAt`;首页带 NEW 同基准。轮询增量经 `mergeFeedItems`(id 去重 + 服务端同构序 publishedAt desc/id 数值 desc)即刷即渲染,未读锚 `seenTopId`(已见首行 id)驱动浮条计数(中段插入的补扫行不计);带宽前插同函数重排后截回一页(见 arch/02 §3.2 M15 注记)

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

### 2.1 贴图 URL 终态:/pins/&lt;id&gt;-&lt;slug&gt;(2026-10-22 M41 新增)

与文章同款 id 锚定纪律,唯一构造/解析出口 `src/lib/content/pin-path.ts`(纯函数零 IO,单测钉死;全站贴图链接只许经 `pinPath` 构造):

1. 贴图详情 URL = `/pins/<id>-<ascii-slug>/`;slug 无库列,渲染时由 `asciiSlugFromTitle(title)` 派生(与文章同款实现),纯中文标题 → bare-id `/pins/<id>/` canonical
2. 解析 `parsePinSegment` 只认 `<digits>[-anything]`,按前导数字段取 id;`/pins/[segment]` 页对比 canonical 段,不一致 `permanentRedirect`(308)归一
3. 墙页 `/pins/`(瀑布流,revalidate 600)+ 详情 `generateStaticParams` 只返 canonical 段(`listPinSegmentsForPrerender`);sitemap 收录墙页 + 全部 published 贴图(priority 0.7 weekly)

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
5. **后台路由迁移(M42)**:`next.config.ts` redirects 承接 `/admin/topics` → `/admin/studio` 与 `/admin/topics/:path*` → `/admin/studio/:path*`(308;`trailingSlash` 归一后尾斜杠形态另列一条),老书签不断
6. **2026-10 URL 迁移行**:`legacy_url_map` 增 103×301(旧中文单段链 → `/post/<id>-<slug>/`,目标带尾斜杠单跳直达)与 53×410(下架删除文);`/[slug]` 页自迁移起为纯 legacy 引擎(不再直接供文,见 §1);Redis `legacy:map:*` 缓存 1h——**部署后须 flush 该前缀**,否则旧行(404/旧目标)最长多活 1h

## 7. 管理后台(/admin)

- 壳层:`(admin)/admin/layout.tsx` 服务端守卫(`requireAdminPage`,未登录 307 → 登录页)+ 客户端 `AdminShell`(sidebar + crumb 顶栏,antd 图标子集经 AdminSprite);API 层 `requireAdmin()` 双重防护。窄屏(M13):<1024 sidebar 抽屉化(hamburger 呼出 / 遮罩·Esc·路由切换关),≥1024 固定 220px 常驻;表格 `overflow-x-auto` 横滚,弹层窄屏全宽/流式
- 文章编辑器:**Markdown 主编辑区 + 实时预览**(`@uiw/react-md-editor` 或等价轻量方案);元信息表单:标题(自动生成 slug)、分类、标签多选、封面、SEO 字段、发布
- **一键发文(2026-09-29 需求,一期交付)**:
  - Markdown 导入:「导入 .md / 粘贴」→ 解析全部图片引用 → 弹窗批量上传本地图片(选择文件夹/拖拽/zip,sha1 去重)+ 外链图调 `POST /api/media/import` 转存 → 以返回映射自动替换 md 中的引用为站内 URL → 进编辑器;编辑器内截图粘贴直接走上传管线
  - 封面工作流(M14 批⑤⑥ 已交付):`CoverDialog` 双源选图(本地上传 / 媒体库轻列表 `GET /api/media/pick`)+ 内置裁剪器(react-easy-crop),五模板一次裁剪多尺寸导出——微信公众号 2.35:1 / OG 1200×630 / CSDN 16:9 / 通用横图 / 列表缩略图(前端 canvas 裁剪压缩后按 `cover` 变体上传);AI 文生图已点亮(`cover-gen` 队列 attempts=1 按张计费,coverContext 无标题禁用,逐张落 ai_usage_log 台账)
- 编辑旧文:content_html 只读展示(提示"旧文保真,如需改写请转 Markdown 重发布"),避免双向转换损毁
- **创作中心 `/admin/studio`(M42,原专题管理 `/admin/topics*` 308 承接;M43 v2 交互重构为三栏工作台)**:端到端创作台——一个创作项目可出 1 篇长文 + N 张贴图,创作素材必须来自系统内既有条目(解读视频/电报文本/历史文章),agent 可自行搜索补挂。列表(M43 v2):状态分段带计数 × 产出过滤(全部产出/长文创作/贴图创作,`?status=&output=`)× 标题搜索(`?q=`,insensitive contains),三列创作卡(标题/状态徽标/产出徽标 + 进度链「素材 n · 长文 ✓|未生成 · 贴图 n」,整卡链入详情,`pinCountByTopic` groupBy 计数)。详情(M43 v2,参照 Figma/剪映类三栏创作台)= 顶栏 + 工作台:顶栏(返回/状态徽标/标题行内编辑/人工流转钮/状态提示语);左素材栏 264px(分型素材卡 + 「添加素材」弹层:电报/文章页签 + 搜索 + 候选行 + 分页,客户端只持开关态、候选列表仍服务端由 `?mount/q/page` 驱动,深链 `?mount=` 直开);中舞台页签「长文 n | 贴图 n」单点驱动舞台与右配置(`hidden` 切换不卸载,未保存配置不丢;默认页签随主意图)——长文页签=长文产出卡,贴图页签=贴图网格(hover 浮层「去组装台/前台预览/删除」)+ 底部吸附创作条(补充要求 + 恒有「生成长文」「生成贴图」两动作,均经 `openAgentAssistant` 交全局宿主卡执行);右配置栏 312px(长文=四维写作要求 chips+封面勾选+补充要求;贴图=张数/比例/首图裁剪/风格/参照图/补充要求(参照图轨:服务端候选点选[绑定样例图 → 样例图库全量 → 视频封面 → 文章配图 → 本创作贴图] + 上传/剪贴板粘贴入口,均经 `uploadImageFile`→`POST /api/media` 管线入库,路径写「参照图:」条款行随保存落库;M44 验收反馈);两套独立列互不派生;M43 修订:窄栏紧凑重排,选项说明降为悬浮提示,样例与样例参照图库入口移除——`/api/writing-samples` 与已绑数据保留;M44 状态驱动交互(按定稿原型 F2/F5/F6/F7):**生成态=纯前端态**(topic 与 agent 线程无持久化关联,零 schema 改动;跨标签页不可见为已知取舍)——点生成时记落库基线 `{status,updatedAt,linkedPostId,pinIds}`(服务端随 props 下发),`StudioGenerationProvider` 5s 轮询 `GET /api/topics/[id]/studio-state` + 监听 `agent:run-inactive` 即时比对双路径判完成,**完成信号按 kind 分**:post=linkedPostId 出现或 updatedAt 推进,pin=pinIds 集合新 id(`save_topic_pin` 对 drafted 重生成不动 topic 行);完成 → `router.refresh()` 整页重取+绿色横幅(可关)+ 新贴图卡「新」徽标(基线集差集),sessionStorage 同标签页刷新恢复,8min 超时静默清态(成败以助手对话与落库真值为准,不发假横幅)。舞台四态:产出空=三步引导卡(挂素材→确认配置→点创作条,首个未完成步标「当前步骤」)/生成中=进度卡(阶段示意四步+indeterminate 条+骨架瓦片,不伪造逐张进度)/刚完成=横幅+「新」徽标/稳态=产出卡;素材栏底部就绪锚点(n≥2 绿「素材已就绪·可以开始生成」/n=1 amber)与右栏 items-stretch 拉满实现三栏底边对齐;创作条状态化(barLeft 标题态机:先准备素材/下一步:生成初稿(随主意图)/创作动作·生成中(按钮禁用)/本轮已完成 ✓/创作动作,长文已发布带 ✓;barRight 两按钮统一 `px-4 py-2 text-[13px]` 长文实底/贴图描边;补充要求收 details 折叠;按钮 accessible name 与空素材行内拦截回显不漂移——e2e 依赖))
- **评论管理页 `/admin/comments`(M23 批③,照 /admin/feedback 模板)**:RSC 直调 service(不开列表 API);三分段 tab(全部/显示/隐藏——先发后审无 pending 段)+ 内容/作者关键词搜索 + 分页;行内状态流转(隐藏/恢复两态互切)+ 删根连带(confirm 明示回复数,物理不可逆);WP 迁移评论带「WP」徽标;写 API `PUT/DELETE /api/post-comments/[id]`(仅会话)
- **媒体库页(重点,详见 arch/08-media)**:图片/视频/文件 Tab + 引用状态过滤(已引用/未引用孤儿/断链)+ 重复检测 + 批量操作 + 存储统计
- 用户/数据页:AntD Table + 服务端分页
- 用量统计页 `/admin/usage`(M14 批⑦):RSC 直聚合一屏出数(`lib/ai/usage-queries`,轻聚合不进 BullMQ);KPI×4(tokens/估算费用/ASR 转写/降级次数)+ CN 日趋势 + 任务·模型分布 + 明细 spark;窗口 7/30/90 天链接切换;费用读时按牌价现折,台账 `ai_usage_log` 逐次落行、90 天保留期(worker 04:52 日清 + 手动清理按钮)

## 8. 组件与样式

- components 按 domain 分包:`site/`(Header/Footer/分页)、`article/`(卡片/正文渲染器/VideoPlayer)、`auth/`、`admin/`、`media/`
- 正文渲染器 `ArticleBody`:content_md 走 react-markdown(+ rehype-highlight);content_html 走 `dangerouslySetInnerHTML`(入库前已清洗,前端不二次清洗)+ `styles/prose.css` 兜底
- VideoPlayer 双模式:COS MP4(`<video>` 原生)/ B 站 iframe 嵌入(arch/08-media §2)

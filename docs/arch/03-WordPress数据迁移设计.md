# WordPress 数据迁移设计

> 源站数据已于 2026-09-29 实库摸底(本地 `17aitech/mysql_data` 镜像,容器 `wp_mysql`,库 `wordpress_db`,表前缀 `wp_`),同日二次复核修订了手机号/标签/浏览量/短码口径。本文是迁移脚本(scripts/migrate_wp/)的设计依据与验收口径。

## 1. 源数据摸底结论(迁移输入)

| 项 | 数值/结论 |
|----|-----------|
| 已发布文章 | 3470 篇 = 行业资讯 3314(**弃**)+ 博客文章 142(**迁**)+ 产品评测 12(**迁**)+ 推广活动 2(弃) |
| 正文形态 | 普通 HTML(Gutenberg 时代),含 `<!-- wp:... -->` 注释(154 篇中 55 篇);短码实测 0 例;**非 Elementor**(页面才是)。曾启用 wp-githuber-md(107/154 篇带 `_is_githuber_markdown=1`),但该插件保存时即转 HTML,`post_content`/meta/revision 均无 markdown 原文(2026-09-29 实库核验:`完全无 HTML 标签` 的文章 = 0),故 `content_md=NULL` 维持。**49 篇嵌 `data:image` base64 图(67 张,单篇最大 1.7MB)**,迁移时解码落盘为 `/wp-content/uploads/data/<sha1>.<ext>` |
| slug | **中文 percent-encoded**(如 `%e3%80%90%e5%b7%a5...`),存储于 `wp_posts.post_name` |
| 用户 | 296 个;`mobile_phone` meta 共 246 行,244 个**格式有效**(user 1/3 两行为空串);其中 1 例跨用户重复(保留最早注册者 wp_user_id=18,败者转待绑定 → **active 243 / `pending_binding` 53**);`user_login` 多为手机号形态;邮箱多为 `xxx@email.empty` 占位;密码 WP phpass |
| 媒体 | uploads 共 19GB / 5.2 万文件(DB attachment 5076,其余为缩略图变体);正文 URL 形如 `/wp-content/uploads/YYYY/MM/file.ext` |
| 付费 | wp_wpcom_orders 33 笔(虎皮椒 wxpay-xunhu,28 成功共 ¥223.30);去重后 4 篇付费文章,**35448 / 38565 属博客文章(迁移范围内)** |
| SEO | Yoast(`wp_yoast_indexable`:title/description);permalink `/%postname%/`;分类/标签基础路径为默认 `/category/`、`/tag/` |
| 浏览量 | `wp_post_views`(id, type, period, count),PK=(id,type,period);**type 0=按日(YYYYMMDD)/1=按周/2=按月/3=按年/4=全量,是同一总量的五种粒度,严禁跨 type 求和**(初版摸底的"Top PV 8.37万/8.18万"即为 5 倍重复求和的勘误)。真实口径(插件展示 = type=4):全库 Top1 post 213 = 237,203(资讯,不在迁移范围);**迁移范围内 Top1 = post 13611《课程总结 day24(上)》= 17,310**,Top2 = 37213 = 16,739;154 篇总 PV 443,795;type=0 日明细范围内 73,067 行 |
| 弃用 | 评论 68 条(61 approved)、问答 7 篇、积分 0 使用、WooCommerce 0 订单、22 个 WP 功能页(shop/cart/login 等) |

## 2. 范围与总映射

```
wp_posts(post, publish, cat∈{blog,report})  ──▶ content_post        (154 篇)
wp_terms / wp_term_taxonomy(tag,仅保留文章关联的) ──▶ content_tag   (实测 22 个;全库 post_tag 仅 23 term,151/154 篇有标签)
wp_terms(category 四条)                     ──▶ content_category   (种子预置,迁移只挂关系)
wp_posts(attachment,被引用闭包)             ──▶ content_media + 文件拷贝
wp_users + wp_usermeta                      ──▶ user_account       (296 全量)
wp_post_views                               ──▶ stats_post_view_daily + views_count 聚合
全部旧 URL(3470 slug + 分类/标签/页面路由) ──▶ legacy_url_map     (301 映射)
wp_wpcom_order_items(premium-content)       ──▶ 仅产出 JSON 报告,二期付费上线时导入权益
```

**时间口径**:发布时间取 `post_date`(北京时间语义),入库转 aware UTC;`created_at` 回填 `user_registered` / `post_date`。

## 3. 文章字段映射

| 源 | 目标 | 规则 |
|----|------|------|
| `ID` | `wp_post_id` | 溯源锚点,unique |
| `post_name` | `slug` | **原样保留编码形态**,不做任何转码/改写 |
| `post_title` | `title` | 原样 |
| `post_excerpt` | `excerpt` | 空则 NULL(前端截摘要由渲染层处理,不回写库) |
| `post_content` | `content_html` | 经 §4 清洗后入库;`content_md` 为 NULL(GitHuber MD 调查见 §1,原文未留存) |
| `_thumbnail_id` → attachment | `cover_path` | 经 `content_media.path`;无缩略图则 NULL |
| Yoast indexable `title`/`description` | `seo_title`/`seo_description` | 缺失则 NULL(前端回退 title/摘要) |
| `post_date_gmt` | `published_at` | 直接可信转 UTC(实库 0 异常,故不用本地时区字段换算) |
| 分类(blog/report) | `category_id` | 一对一(源数据每篇仅一个分类) |
| 标签关联 | `content_post_tag` | 仅迁目标文章的标签 |
| `post_name` 以外的草稿/修订 | 不迁 | `post_status != 'publish'` 全部跳过 |

## 4. 正文 HTML 清洗规则(唯一实现:src/lib/content/clean-html.ts,迁移与后台粘贴共用)

目的:去掉 WP 运行时痕迹,保留语义标签。**白名单制**,未列出的标签剥壳留文本:

- 删除:所有 `<!-- wp:... -->` Gutenberg 注释;`<script>`/`<style>` 整体删除;`<iframe>` 仅保留 bilibili/youtube 白名单域(其余删除并记报告);`<!--more-->`(含 `<!--more 自定义文案-->`)改为 `<!-- more -->` 标准分隔
- data: URI 图:迁移阶段解码落盘为 `/wp-content/uploads/data/<sha1>.<ext>`(2026-09-29 决策,49 篇 67 张);若未落盘(如后台粘贴未走上传管线)则剥离 src 并告警,防止巨串入库
- 短码转换(2026-09-29 复核:已发布文章实测 0 例,规则保留作防御):`[caption]...[/caption]` → `<figure><figcaption>`;`[su_*]` 按内部内容剥壳;其余未知成对短码删除并记报告;`[gallery]` 等自闭合杂项删除;清洗后仍残留疑似短码只报不删(中文正文合法使用 `[]` 常见,防误伤)
- 标签白名单:h1-h6, p, a, img, ul/ol/li, blockquote, pre, code, table/thead/tbody/tr/th/td, figure/figcaption, strong/em/del, hr, br, span(仅保留 style 内的文字对齐/加粗类),iframe(仅域白名单内);`b/i/s/strike` 语义改名为 `strong/em/del` 后保留;`video/audio` 等携带 uploads 资源时剥壳前记警告(媒体闭包从原文提取,不丢文件)
- 属性白名单:`a[href,title]`,`img[src,alt,width,height,loading=lazy(统一补)]`,`code[class*=language-]`,`th/td[colspan,rowspan](结构保真)`,iframe 白名单属性;`img` 的 `srcset/sizes` 剥离(闭包只跟主 src)
- 相对化:`http(s)://17aitech.com|www|dev` 三域内链/内图改写为站内相对路径(实跑改写 1,448 处);外链不动
- 产出 `migration_report`:每篇的清洗动作计数、删除的短码清单、疑似丢失内容警告(实跑 2026-09-29:Gutenberg 注释 191、script 141/style 308(主要来自 wp:html 块内嵌的整页 HTML)、属性剥离 20,266、疑似丢失 = 0)

## 5. 媒体策略(零改写原则)

- **只迁 154 篇文章的引用闭包**:正文/封面引用的每个 `/wp-content/uploads/...` URL → 对应文件
- **URL 路径原样保留**(含 `/wp-content/uploads/` 前缀):Nginx 将该前缀映射到 `media/` 目录 → 正文 HTML 零改写、Google 图片索引零损伤
- 引用闭包提取:① `content_html` 内所有 `src`/`href`;② `_thumbnail_id` 链;③ 对每个命中 URL 做解码还原(中文文件名),在 uploads 树定位文件
- 依赖 WP 渲染期注入的资源(srcset 变体等)**不需要**:新站直接渲染清洗后 HTML,不跑 WP filter
- 文件拷贝:生产机 `rsync` uploads → 新栈 `media/` 时按 `--files-from` 清单(由引用闭包生成)过滤,预计数百 MB~1GB;`data/` 前缀(base64 解码图)不在 uploads 树,来自 artifacts/base64-media,rsync 后需单独拷入(media-manifest 已处理,本地实跑 1,190 文件 631MB 零缺失)
- 每个文件入 `content_media`(path 唯一,sha1 去重);对账要求:**154 篇清洗后正文里出现的每个 uploads URL,在 media/ 下都存在文件**(verify 阶段 100% 校验)

## 6. 用户迁移

| 源 | 目标 | 规则 |
|----|------|------|
| `wp_users` 全量 296 | `user_account` | 一条不落;`wp_user_id`/`legacy_username` 留档 |
| `mobile_phone` meta | `phone` | 11 位校验;重复手机号保留最早注册者,其余置 NULL 记报告(2026-09-29 迁移实跑:实测 1 例重复,保留 wp_user_id=18 → active 243 / pending 53;2 行空串属 user 1/3) |
| 无手机号(53 个:52 无 meta/非法 + 1 重复落败) | `status='pending_binding'` | 登录前需绑定手机号;若 `user_login` 为 11 位纯数字则直接回填 phone 并记报告(实测 0 例,规则保留作防御) |
| `wp_capabilities` 含 administrator | `role='admin'` | 仅站长一个;其余一律 `user` |
| `user_pass`(phpass) | `legacy_phpass` | **仅审计留存,永不参与登录**;密码体系见 05 文档 §3 |
| `user_registered` | `created_at` | 转 UTC |
| `nickname`/`description` | `nickname`/`bio` | 空则 NULL,不造默认值 |

## 7. 付费权益(二期消费,一期只留证据)

- 脚本导出 `premium_orders.json`:`order_items`(user × post × price × time × status=paid)→ 归档到 `docs/` 外的 `scripts/migrate_wp/artifacts/`
- 二期付费模块上线时:`pay_order` 导入历史订单,`content_post_purchase` 为 (35448, 38565) 两篇的全部已购用户建权益
- **红线:任何情况下不得让已付费用户失去已购文章访问权**(requirement §4 约束)

## 8. legacy_url_map(301 全量承接)

切换日前由脚本灌入,`legacy/[...path]` 路由(04 文档 §6)据此 301:

| 旧 URL 形态 | 目标 | 说明 |
|------------|------|------|
| `/<资讯 slug>/`(3314 篇) | `/articles` | 权重收敛到列表页,不用 404 |
| `/<推广活动 slug>/`(2 篇) | `/` | |
| `/category/news/`、`/category/advertising/` | `/articles`、`/` | 分类页本身新站仍建(空列表),此项可不配;默认配置为 301 至对应新路由 |
| `/tag/<未迁移 tag>/` | `/articles` | 迁移 tag 的新站直接 200,不进映射 |
| `/主页/` | `/` | |
| `/用户协议/`、`/隐私政策/` | `/agreement`、`/privacy` | 新站重建这两页 |
| `/开发日志/`、`/ai_knowledge/`、`/ai_resources/`、`/大模型专题页/` | `/` | 内容弃用;若二期做专题再补 301 |
| `/shop|cart|checkout|my-account/` | `/` | WooCommerce 弃用 |
| `/register|login|lostpassword|social-login|account|profile/` | `/login` 或 `/account` | 旧账号功能页 → 新站对应页 |
| `/ai_qa*` 全系 | `/` | 问答弃用 |
| `/feed/` | `/feed.xml` | Nginx 层直接 301,不入表 |

## 9. 浏览量聚合

- 源:`wp_post_views`(id, **type, period**, count;PK=(id,type,period))。**type 0=按日(period=YYYYMMDD)/1=周/2=月/3=年/4=全量(period='total'),同一总量的五种粒度,严禁跨 type 求和**
- 提取:日明细取 `type=0`;总数取 `type=4`(post-views-counter 插件前台展示口径,已核对插件源码 class-query.php)
- 目标:`stats_post_view_daily`(明细)+ `content_post.views_count`(总数,应用层新增浏览走 UPSERT 日行 + 累加总数)
- 迁移日做一次快照对账:Top10 文章 PV 与源站一致(验收 §7.6;实跑 2026-09-29:Top1 = 13611 = 17,310,154 篇总和 443,795)

## 10. 脚本设计(scripts/migrate-wp/,TypeScript,与主应用同仓)

```
migrate-wp/
├── config.ts             # 源 DSN(WP MySQL)/目标 DSN(PG)/路径,env 覆盖
├── extract.ts            # 只读连接源库(mysql2),抽取原始行 → artifacts/extract_*.json(可重放,不重复连库)
├── transform.ts          # 清洗/映射(§3/§4/§6),产出 load 计划 + migration_report(纯函数,单测主战场)
├── clean-html.ts         # §4 清洗实现(cheerio);与主应用共享的清洗规则同文件放 src/lib/content/,此处复用
├── media-manifest.ts     # 引用闭包 → media_files_from.txt(rsync --files-from 用)
├── load.ts               # 写 PG(pg,幂等 UPSERT by wp_*_id/path)+ legacy_url_map
├── verify.ts             # §11 验收对账,输出 PASS/FAIL 报告
└── run.ts                # 编排:extract → transform → [--dry-run 停] → load → verify(tsx 直跑)
```

- **与主应用共享代码**:`normalizeSlug`(src/lib/slug.ts)与 HTML 清洗规则单一实现,迁移脚本与运行时共用——避免两侧逻辑漂移(这是选 TS 而非 Python 写迁移的核心原因)
- **幂等**:load 全部按业务键 UPSERT(wp_post_id / wp_user_id / path),可反复重跑
- **dry-run**:只出报告不落库,review 后再实跑
- **源库**:支持两种——本地 `wp_mysql` 容器(开发迭代)+ 生产只读隧道(切换前实跑);切换前必须以**生产库 + 生产 uploads** 为源重跑一次(load 到生产 PG)
- 依赖:`tsx` 直跑,`mysql2` + `pg` + `cheerio`;**不引入 Prisma**(迁移走裸 SQL UPSERT,避免 ORM 与一次性脚本的耦合)

## 11. 验证与对账(verify.ts,对应 requirement §7)

1. 计数:content_post=154;content_post_tag 关联数 = 源查询同口径;user_account=296
2. 内容完整性:154 篇全量哈希比对(title/published_at/content_html),另抽样 20 篇查 `wp:` 注释与短码残留(实跑 2026-09-29 增强:全量哈希替代逐字段抽样)
3. 图片闭环:154 篇正文+封面全部 uploads URL ∈ content_media 行且 media/ 下存在文件(100% 校验)
4. URL 抽样:30 个资讯 slug → 301 `/articles`、30 篇保留文章 slug 在库(DB 层);HTTP 实测(30 篇 → 新站 200)待 M3 前台路由落地后以 `--phase=verify --http` 启用,M6 切换前必须执行
5. 用户:**active 243(有效手机号)+ 53 `pending_binding`**(含 1 例重复手机号按规则落败);重复/异常清单人工确认
6. 浏览量:Top10 PV 一致(口径 = 插件 type=4)
7. 全部结果落 `artifacts/verify_report.json`,FAIL 项阻断 M6 切换

**实跑记录(2026-09-29,本地 wp_mysql → dev PG)**:七条全 PASS;154 文/22 标签/1190 媒体(631MB,零缺失,含 67 张 base64 解码)/1341 引用/296 用户/73,067 浏览日行/3,432 legacy 映射;load 幂等重跑通过;`lossWarningsNeedingReview` 为空。

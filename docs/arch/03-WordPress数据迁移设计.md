# WordPress 数据迁移设计

> 源站数据已于 2026-09-29 实库摸底(本地 `17aitech/mysql_data` 镜像,容器 `wp_mysql`,库 `wordpress_db`,表前缀 `wp_`),同日二次复核修订了手机号/标签/浏览量/短码口径。本文是迁移脚本(scripts/migrate_wp/)的设计依据与验收口径。

## 1. 源数据摸底结论(迁移输入)

| 项 | 数值/结论 |
|----|-----------|
| 已发布文章 | 3470 篇 = 行业资讯 3314(**弃**)+ 博客文章 142(**迁**)+ 产品评测 12(**迁**)+ 推广活动 2(弃) |
| 正文形态 | 普通 HTML(Gutenberg 时代),含 `<!-- wp:... -->` 注释(154 篇中 55 篇);短码实测 0 例;**非 Elementor**(页面才是) |
| slug | **中文 percent-encoded**(如 `%e3%80%90%e5%b7%a5...`),存储于 `wp_posts.post_name` |
| 用户 | 296 个;`mobile_phone` meta 共 246 行,**有效手机号 244 个**(user 1/3 两行为空串),无重复;`user_login` 多为手机号形态;邮箱多为 `xxx@email.empty` 占位;密码 WP phpass |
| 媒体 | uploads 共 19GB / 5.2 万文件(DB attachment 5076,其余为缩略图变体);正文 URL 形如 `/wp-content/uploads/YYYY/MM/file.ext` |
| 付费 | wp_wpcom_orders 33 笔(虎皮椒 wxpay-xunhu,28 成功共 ¥223.30);去重后 4 篇付费文章,**35448 / 38565 属博客文章(迁移范围内)** |
| SEO | Yoast(`wp_yoast_indexable`:title/description);permalink `/%postname%/`;分类/标签基础路径为默认 `/category/`、`/tag/` |
| 浏览量 | `wp_post_views` 明细 102.75 万行(154 篇迁移范围内约 9 万行);热门文章 8 万+ PV(8.37万/8.18万) |
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
| `post_content` | `content_html` | 经 §4 清洗后入库;`content_md` 为 NULL |
| `_thumbnail_id` → attachment | `cover_path` | 经 `content_media.path`;无缩略图则 NULL |
| Yoast indexable `title`/`description` | `seo_title`/`seo_description` | 缺失则 NULL(前端回退 title/摘要) |
| `post_date` | `published_at` | Asia/Shanghai → UTC |
| 分类(blog/report) | `category_id` | 一对一(源数据每篇仅一个分类) |
| 标签关联 | `content_post_tag` | 仅迁目标文章的标签 |
| `post_name` 以外的草稿/修订 | 不迁 | `post_status != 'publish'` 全部跳过 |

## 4. 正文 HTML 清洗规则(transform 阶段,可单测)

目的:去掉 WP 运行时痕迹,保留语义标签。**白名单制**,未列出的标签剥壳留文本:

- 删除:所有 `<!-- wp:... -->` Gutenberg 注释;`<script>`/`<style>`/`<iframe>`(除 bilibili/youtube 白名单域,一期直接删并记报告);`<!--more-->` 改为 `<!-- more -->` 标准分隔
- 短码转换(2026-09-29 复核:已发布文章实测 0 例,规则保留作防御):`[caption]...[/caption]` → `<figure><figcaption>`;`[su_*]`(unlimited-elements)按内部内容剥壳;其余未知短码删除并记报告
- 标签白名单:h1-h6, p, a, img, ul/ol/li, blockquote, pre, code, table/thead/tbody/tr/th/td, figure/figcaption, strong/em/del, hr, br, span(仅保留 style 内的文字对齐/加粗类,其余 class/style 剥离)
- 属性白名单:`a[href,title]`,`img[src,alt,width,height,loading=lazy(统一补)]`,`code[class*=language-](保留语言标记)`
- 相对化:正文中 `https://17aitech.com/...` 内链改写为站内相对路径(避免域名硬编码);外链不动
- 产出 `migration_report`:每篇的清洗动作计数、删除的短码清单、疑似丢失内容警告

## 5. 媒体策略(零改写原则)

- **只迁 154 篇文章的引用闭包**:正文/封面引用的每个 `/wp-content/uploads/...` URL → 对应文件
- **URL 路径原样保留**(含 `/wp-content/uploads/` 前缀):Nginx 将该前缀映射到 `media/` 目录 → 正文 HTML 零改写、Google 图片索引零损伤
- 引用闭包提取:① `content_html` 内所有 `src`/`href`;② `_thumbnail_id` 链;③ 对每个命中 URL 做解码还原(中文文件名),在 uploads 树定位文件
- 依赖 WP 渲染期注入的资源(srcset 变体等)**不需要**:新站直接渲染清洗后 HTML,不跑 WP filter
- 文件拷贝:生产机 `rsync` uploads → 新栈 `media/` 时按 `--files-from` 清单(由引用闭包生成)过滤,预计数百 MB~1GB
- 每个文件入 `content_media`(path 唯一,sha1 去重);对账要求:**154 篇清洗后正文里出现的每个 uploads URL,在 media/ 下都存在文件**(verify 阶段 100% 校验)

## 6. 用户迁移

| 源 | 目标 | 规则 |
|----|------|------|
| `wp_users` 全量 296 | `user_account` | 一条不落;`wp_user_id`/`legacy_username` 留档 |
| `mobile_phone` meta | `phone` | 11 位校验;重复手机号(若出现)保留最早注册者,其余置 NULL 记报告(2026-09-29 复核:实测 0 重复、2 行空串属 user 1/3) |
| 无手机号(52 个) | `status='pending_binding'` | 登录前需绑定手机号;若 `user_login` 为 11 位纯数字则直接回填 phone 并记报告(实测 0 例,规则保留作防御) |
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

- 源:`wp_post_views`(id, day, type, count 明细)→ `SELECT id, day, SUM(count) GROUP BY id, day`
- 目标:`stats_post_view_daily`(明细)+ `content_post.views_count`(总数,应用层新增浏览走 UPSERT 日行 + 累加总数)
- 迁移日做一次快照对账:Top10 文章 PV 与源站一致(验收 §7.6)

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
2. 内容抽样:随机 20 篇,源 `post_title`/`post_date` 与目标一致;正文经清洗后无残留 `wp:` 注释、未知短码
3. 图片闭环:154 篇正文全部 uploads URL ∈ media/ 文件集合(允许 sha1 校验抽样)
4. URL 抽样:30 篇保留文章 → 新站(本地栈)200;30 个资讯 slug → 301 `/articles`
5. 用户:244 有效手机号 + 52 `pending_binding`;重复/异常清单人工确认
6. 浏览量:Top10 PV 一致
7. 全部结果落 `artifacts/verify_report.json`,FAIL 项阻断 M6 切换

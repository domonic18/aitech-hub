# 服务层与异步任务设计(src/lib/ + worker/)

> 单体架构下没有独立后端应用,本文定义**业务库层**(`src/lib/`,被 RSC 页面与 Route Handlers 共用)与**异步任务**(`worker/`,BullMQ)的设计。分层纪律承袭 ai-invest-assisstant:薄处理、重服务、事务边界清晰。

## 1. 分层

```
页面(RSC)/ Route Handler  →  service(lib/content, lib/media, lib/auth ...)  →  Prisma(db.ts)
```

- **页面与 Handler 只做协议层**:参数解析(Zod)、鉴权、响应包络、状态码;**禁止页面/Handler 内出现裸 Prisma 调用**(一律经 service)——保住"业务只有一份实现"的单体底线
- service 可互相组合;**service 之上才有 revalidatePath / enqueue 等副作用编排**
- `lib/db.ts` Prisma 单例、`lib/redis.ts` Redis 单例,全项目唯一

## 2. 事务边界(强制,范例项目同款)

- Prisma 交互式事务 `prisma.$transaction(async tx => ...)` 只出现在 **service 层**;页面/Handler 禁止开事务
- 写操作成功后再做副作用:`revalidatePath`、`queue.add()`——**先提交事务后发副作用**,失败补偿靠幂等(任务可重跑、revalidate 可重放)
- 批量写:分批 + 单条容错(捕获记录继续,参照范例 begin_nested 精神);迁移脚本走裸 SQL UPSERT 自管事务
- 禁止 `prisma.$executeRaw` 出现在 service 之外的任何地方(统计聚合等复杂查询集中 `lib/content/queries.ts` 并注释说明)

## 3. 认证与会话(src/lib/auth/)

### 3.1 admin 密码登录(一期唯一鉴权;短信登录设计保留三期启用)

> 2026-09-30 收缩:运营商个人签名资质停发,用户短信登录延后三期(requirement §3.3);一期鉴权仅服务后台 admin,前台无登录入口。

```
POST /api/auth/login    { phone, password } → bcrypt.compare → 下发会话 Cookie
POST /api/auth/logout                 → 吊销会话(Redis 删登记)
GET  /api/auth/session                → 当前用户(客户端 hydrate 用)
```

- admin 账号经 `npm run admin` 交互式创建/重置(手机号 + 密码,bcrypt 10 轮,`role=admin` upsert;重跑即改密);不预置 seed
- **`legacy_phpass` 永不参与校验**(纯审计)
- **爆破防护**(Redis 计数,阈值进 env):同账号连错 5 次锁 15min;同 IP 日失败上限 50 次;超限 429——失败提示不区分"锁定"与"密码错",不给人枚举面
- 日志安全:手机号掩码(`138****1234`);密码/哈希永不落日志;登录成功/失败/锁定/登出记 `auth` 事件(pino,后台可视化属 M5+)
- 三期启用短信登录时恢复原设计(sms-code 频控同号 60s/次日 10 条、腾讯云下发、未注册自动注册);BullMQ 周期任务实现注见 §4(upsertJobScheduler)

### 3.2 会话机制(httpOnly Cookie,单体自然形态)

- **单会话 Cookie(2026-09-30 定稿;双 token 方案移三期用户中心)**:jose 签名 JWT 装入 `ah_at` httpOnly + SameSite=Lax Cookie(`secure` 生产开启),有效期 7d,载荷 `{ sub, role }` + `jti`
- `jti` 登记进 **Redis 会话表**(TTL 对齐 7d):登出即删、可单点吊销;校验 = JWT 本地验签 + `jti` 登记存在性双查(封住"签发后即吊销"窗口)
- **滑动续期**:剩余有效期 <1d 时随响应下发新 Cookie(滚动 7d),连续活跃不掉线
- `middleware.ts`:/admin 路径做 Cookie 存在性 + JWT 本地有效期预检(**不查 Redis**——middleware 运行环境约束;完整校验仍在 service/Handler,防伪不靠 middleware)
- 并发登录共存:多处登录各持独立 jti,吊销互不影响(不做"单点踢下线",YAGNI)
- admin 判定:`role==='admin'` + `requireAdmin()` 在 admin 端点逐个叠加(不信任 middleware)

### 3.3 安全红线

- 外部输入一律 Zod 边界校验;上传类型+大小白名单,文件名重生成(sha1)
- Origin/Host 校验:所有 mutation 类 Route Handler(arch/07-frontend §4)
- CORS:Next 同源架构默认无跨域;若未来开放 API 再显式配置白名单
- 安全事件记录:登录尝试/爆破锁定/权限拒绝/上传拒绝(pino `auth` 事件)

## 4. 异步任务(worker/ + BullMQ)

### 4.1 队列与纪律

- 单 Redis,队列按域命名:`media`(一期)、`github`、`crawler`、`pay`(二期启用)
- **请求内禁做秒级以上处理**(arch/00-overview §7):一切转码/压缩/抓取/同步 enqueue 后立即返回 `{ jobId }`
- 任务幂等:所有 processor 以业务键去重(jobId 用 `media:{sha1}:process` 形态),可重复投递
- worker 独立进程 `worker/index.ts`:注册 processors、优雅退出(SIGTERM 排空)、失败重试(指数退避,上限 3 次)+ 死信记录

### 4.2 一期任务清单

| 队列 | 任务 | 触发 | 内容 |
|------|------|------|------|
| media | `media.process` | 上传成功后 enqueue | sharp:主图 WebP 副本 + 缩略图(thumb_path)、宽高回填、sha1 入库 |
| media | `media.transfer` | md 导入对外链图 enqueue | 抓取外链图片 → LocalDiskProvider 入库(sha1)→ 链式复用 media.process;失败标 error 供编辑器提示 |
| media | `media.audit` | 每日定时(upsertJobScheduler,同 §3.1 实现注) | 孤儿/断链/重复扫描,更新 status 与统计(arch/08-media §3) |
| stats | `stats.flush` | 每 60s(upsertJobScheduler) | 日缓冲 RENAME→HGETALL→聚合表 UPSERT(visit/referrer/page/client/post_view_daily + views_count 累加);失败还原缓冲下轮重试(`lib/stats/service.ts`) |

二期任务(立项时补设计):`github.sync`(仓库同步)、`crawler.*`(Crawlee 资讯采集,设计落点 arch/02-data-collection)、`distribute.*`(微信公众号等渠道分发,publish_channel 状态机)、`pay.*`(对账轮询);agent 触发类长任务设计落点 arch/04-ai-agent。

### 4.3 本地与部署形态

- 本地:`npm run worker`(tsx 直跑);生产:compose `worker` 服务,**与 web 同镜像**,command 覆盖为 `node dist/worker/index.js`(构建期 tsc 编译,outDir=dist)
- worker 内存上限 512m(sharp 处理大图吃内存),并发 = 2 起步,按服务器余量调

## 5. 一期接口清单(Route Handlers)

| 域 | 端点 | 鉴权 |
|----|------|------|
| auth | login / logout / session | 公开(login 有爆破防护,§3.1) |
| content | `GET /api/posts`(管理列表,草稿含)、`POST/PUT/DELETE /api/posts/[id]`、`publish/unpublish`(POST 建文 slug 缺省由标题派生,冲突自动追加 `-2…-9` 后缀;显式指定冲突仍 409) | admin |
| content | `GET /api/search?q=` | 公开 |
| stats | `POST /api/view { path, referrer? }`(同源校验 + bot/管理员过滤) | 公开(IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,Redis 缓冲 60s 批量落库) |
| media | `POST /api/media`(上传)、`POST /api/media/import`(外链图批量转存,enqueue 返回 jobId,前端轮询取映射)、`GET /api/media`(列表/过滤)、`DELETE /api/media/[id]`、`GET /api/media/{orphans,duplicates,stats}` | admin |
| users | `GET/PUT /api/me/profile`、`PUT /api/me/password`、`GET /api/users`、`PUT /api/users/[id]/status` | user / admin |
| legacy | `GET /legacy/[...path]`(web 内部路由,非 REST) | - |
| system | `GET /api/health` | compose healthcheck |

二期预留:`/api/pay/*`(虎皮椒:创建订单 + 异步 notify 回调,回调端点独立鉴权白名单 + 验签)、`/api/github/*`。

## 6. 日志与可观测

- pino 结构化 JSON;`instrumentation.ts` 注册 request id 中间件,响应头回写 `X-Request-Id`
- 慢请求(>500ms)warn 级;`/api/health` 供 compose healthcheck
- worker 日志带 `queue/jobId`;一期不接日志平台,`docker compose logs` 排障

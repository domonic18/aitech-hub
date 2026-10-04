# CICD 与部署

> 本文属 `docs/standard/`(稳定规范:内容不轻易变更,随实现漂移的过程细节回 arch 文档)。
> 参照 ai-invest-assisstant 的 GitHub Actions → 腾讯云 TCR → 服务器 compose 拉取模式;叠加本项目特有的"同服务器原位切换" runbook。单体架构:一个应用镜像(web + worker 两个服务共用)。

## 1. 流水线总览(.github/workflows/ci.yml)

```
PR / push(develop, main)
├── job app       npm ci 缓存 → prettier --check → eslint → tsc --noEmit → vitest 单测
├── job gateway   Python 3.11 + pip 缓存 → pytest services/douyin-gateway/tests(M8 批①;纯单测无网依赖)
├── job migration 起 postgres:16 → migrate deploy 全量 →
│                 幂等重放 → migrate diff --exit-code 一致性断言(standard/01-testing §5)

push(develop, main)/ 手动
└── job docker-release  [依赖 app+gateway+migration 全绿] buildx 构建双镜像 → 推 TCR
                        应用 aitech-hub + 网关 aitech-hub-gateway(services/douyin-gateway/Dockerfile,M8 批①)
                        tag = <branch>-<短 sha>;latest 仅 main(保证 compose pull 默认即发布版)
```

> 实装(M6,2026-10-02):`app` + `migrate-replay` + `docker-release` 三 job(见 `.github/workflows/ci.yml`)。
> docker-release 支持 `workflow_dispatch` 手动触发(首次打通 TCR 用);build 构建在镜像内完成,不设独立 build job。
> 跨境推送(美国 runner → 大陆 TCR)偶发 stall:构建步骤级超时 25 分钟,失败自动重推一次(同范例仓实测经验;网关镜像两个构建步骤同享重试,gha cache scope=gateway 独立)。

- Node 22(`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` 同范例);npm 缓存走 `cache: npm`
- husky + lint-staged 本地门禁(eslint/prettier 限改文件);CI 全量跑,双保险
- TCR 凭证走 repo secrets(`TCR_NAMESPACE`/`TCR_USERNAME`/`TCR_PASSWORD`);镜像 `ccr.ccs.tencentyun.com/domonic18/aitech-hub`;构建带 `provenance: false`(TCR 不认 OCI attestation 附加清单)

### 1.1 分支模型(2026-09-30 起,同 ai-invest-assisstant)

- 常驻分支双主干:`develop`(开发主线)+ `main`(发布线);CI 对两者 push/PR 均触发
- 功能开发:基于 develop 建 `feature/<topic>` 分支(文档 `docs/`、杂务 `chore/`、重构 `refactor/` 同规),完毕 PR 合回 develop
- 发布:develop → main 走 PR;`main` 设分支保护**禁直推**(含管理员),合入只经 PR;develop 不设保护,直推仅限小修正(约定,同参考仓)

## 2. 本地开发链路

```bash
make setup     # cp .env.example .env → npm install → compose up pg(5434)/redis(6380) → migrate deploy → seed
make dev       # next dev :3000(终端 2)
make worker    # tsx worker/index.ts(终端 3;一期仅 media 任务,不跑也不阻塞页面)
make check     # typecheck + lint + 单测
make migrate   # npx prisma migrate deploy
```

- dev compose 只含基础设施;应用本地跑保热更;prod compose 全栈
- pre-commit:lint-staged;pre-push:`make check`

## 3. 镜像(docker/Dockerfile)

- 多阶段:`deps`(npm ci)→ `builder`(next build standalone + tsc worker)→ `runner`(node:22-slim,非 root)
- 产物:`.next/standalone` + `.next/static` + `dist/`(worker 编译产物,tsconfig.worker outDir,入口 `dist/worker/index.js`)+ `prisma/`(migrate 需 schema)+ `scripts/` 与 `src/`(ops 脚本如 `npm run admin` 以 tsx 直跑,依赖 src 源码;显式整拷,勿依赖 standalone 追踪);entrypoint 按 `SERVICE_ROLE=web|worker` 区分启动目标
- `.dockerignore` 排除 `.env`/`docs`/`e2e`/`scripts/migrate-wp/artifacts`/`media`/`workspace`/`CLAUDE.md`/`Makefile`/`docker-compose*.yml`(仓库与运维文件不进构建上下文)
- **媒体目录不打进镜像**:compose 卷挂载,独立于发版

### 3.1 构建期无 DB 降级与启动预热(2026-09-30 实测定型)

- builder 无 env/DB:`ENV` 占位三件套(DATABASE_URL/REDIS_URL/AUTH_SECRET)过 Zod 校验;预渲染取数经 `lib/prerenderSafe`(仅 `NEXT_PHASE=phase-production-build` 生效)降级为空数据,**运行时 ISR 错误照常上抛不吞**
- 降级产物在 revalidate 窗口内不会自动再生 → entrypoint 轮询 `/api/health/` 就绪后:先 `POST /api/internal/revalidate/`(AUTH_SECRET 派生 token,`revalidatePath("/", "layout")` + SEO 路由全量失效)再逐路径双 fetch(首触发再生、次取新鲜产物入缓存);失效端点勿删,预热失败不阻塞启动
- 实测踩坑(均已修,勿回退):
  - runner 的 node_modules 必须取 **builder 层**(含 `prisma generate` 产物;取 deps 层会覆盖 standalone 内 traced 生成物,运行时报 `client did not initialize`)
  - `HOSTNAME=0.0.0.0` 必须显式设——容器 HOSTNAME 是容器 ID,Next standalone 会当绑定地址,回环拒连(预热 ECONNREFUSED)
  - slim 无 openssl,deps/runner 需 apt 安装(prisma 引擎探测)
  - worker:build 须接 `tsc-alias`(`@/` 别名 emit 不改写,产物运行时崩)
  - healthcheck 打 `/api/health/`(trailingSlash 308;compose 探针需带尾斜杠或 `-f` 跟随)
  - 预热不能用「固定 sleep 后单发 POST」:2C 冷启动 server 绑定可晚于 sleep,POST 落空且被吞、无任何日志;页面靠短 revalidate(600s)自然自愈,feed/sitemap(3600s)空壳挂满窗口(2026-10-03 生产实测定诊)——就绪轮询 + 重试 + 双 fetch,见 entrypoint
  - ops 脚本依赖的 src 必须**显式 COPY**:standalone 追踪对源码只带碎片(2026-10-03 实测 `src/lib/auth/` 仅剩 `*.test.ts`,生产镜像 `npm run admin` 必 MODULE_NOT_FOUND);`scripts/`、`src/` 勿依赖追踪带入
  - 定属主用 `COPY --chown`,勿 `RUN chown -R /app`:后者把已拷内容整层 CoW 复制一遍,实测多出 1.08GB 层(镜像层只增不删)

### 3.2 网关镜像(services/douyin-gateway/Dockerfile,M8 批①)

- 独立第二镜像 `aitech-hub-gateway`:`python:3.11-slim` 单阶段,pip 装 requirements 后 `playwright install --with-deps chromium`(签名驱动,含系统依赖层,镜像偏大属预期);与主镜像零共享,`.dockerignore` 仓库级排除互不影响
- CI 与主镜像同一 `docker-release` job 内先后构建(各带重推重试);tag 规则同款 `<branch>-<短 sha>` + `latest` 仅 main
- prod compose 服务 `douyin-gateway`:`image: ${GATEWAY_IMAGE:-…aitech-hub-gateway:latest}`,内网无 ports(worker 经服务名 `http://douyin-gateway:8010` 访问,`x-app-env` 注 `DOUYIN_GATEWAY_URL`);tmpfs 挂 `/tmp/playwright-profiles`(chromium Profile 防容器层写放大);healthcheck urllib 探 `/health`(slim 无 curl 同款问题),`start_period: 60s`(首启含 chromium 拉起);`mem_limit: 1g` + `DOUYIN_SIGNER_WARM_SLOTS: 1`(warm 页吃内存,2C4G 预算钉死单槽)
- dev compose 走 `--profile douyin` 按需起(build 本地,`127.0.0.1:8010` 仅回环,便于 curl 冒烟),不影响日常 pg/redis 起;契约见 arch/05 §4.4
- **网关镜像升级步骤**(契约护栏):黄金样本双侧对拍已进 CI(pytest `test_contract_fixtures.py` + vitest `gateway-contract.test.ts`),升级后另跑一次实弹对拍——`docker compose --profile douyin up -d douyin-gateway` 起本地网关,`npm run test:integration`(gateway 未起自动跳过;真实拉取对拍设 `DOUYIN_INTEGRATION_SEC_UID`/`DOUYIN_INTEGRATION_SHARE_URL` 开启)
- 镜像现状 ≈2.4GB → 消除 chown 复制层后 ≈1.4GB(runner 全量 node_modules 为既有取舍:worker 与 prisma CLI 同镜像所需——web 启动即跑 `npx prisma migrate deploy`,CLI 必须在);进一步瘦身方向:`npm ci --omit=dev` 拆 prod-deps 层 + tsx 入 dependencies,非一期阻塞(2026-10-03 评估)

## 4. 生产拓扑与 Nginx(compose 服务)

实现落位 `docker-compose.prod.yml`(project 名 `aitech-hub-prod`,与 dev compose 同机互不干扰):

```
nginx        80/443(唯一对外;SSL 终结,证书卷挂载 workspace/ssl;80 全量 301 https)
  ├── /wp-content/uploads/*  → 静态 media/ 卷直服(immutable 长缓存;二期切 COS 反代,URL 不变)
  ├── /feed、/feed/          → 301 /feed.xml(nginx 层)
  └── 其余全量反代 web:3000(原始请求串原样透传,中文编码 slug 不经 nginx 归一化)
web:3000     内网 + 宿主回环发布 127.0.0.1:3000(切换日 runbook curl 验证用)
worker       仅内网(同镜像,SERVICE_ROLE=worker;媒体卷读写)
douyin-gateway  仅内网(独立网关镜像;无 ports,worker 经服务名 :8010 访问;M8 批①,§3.2)
redis / postgres  仅内网,不发布端口(redis 开 AOF + 数据卷)
```

- **legacy 兜底差异(实现沉淀)**:兜底已前移到应用层路由——单段旧路径由 `(site)/[slug]` 页承接,`/category/*`、`/tag/*` 页内 fallback,`/legacy/[...path]` 路由保留;实测 `legacy_url_map` 内多段路径仅 3 条且全落在专用路由,nginx 无需 error_page 拦截(还会误伤 API 404)
- **媒体直服两个 nginx 坑(实测沉淀)**:①磁盘文件名为 percent-encoded(与应用侧 normalizeUrlPath 同因),`alias` 按解码后 URI 找文件必 404 → 用 `map $request_uri` 取未解码原始串拼路径;②alias 带变量时 nginx 仍追加"location 匹配后剩余 URI(已解码)",location 必须正则吃满整个 URI
- compose prod:project 名隔离 + `mem_limit` 全线(web 768m / worker 512m / pg 512m / redis 128m / nginx 128m,2C4G 起步值)+ `restart: unless-stopped` + 日志轮转(json-file 10m×3)+ healthcheck(web `node fetch /api/health/`(slim 无 curl)、pg `pg_isready`、redis `ping`)
- **部署顺序纪律由编排表达**:web/worker `depends_on` pg+redis healthy;worker 额外等 web healthy(web entrypoint 先跑 `prisma migrate deploy`,healthy 即 schema 就绪);nginx 等 web healthy
- 镜像:`image: ${APP_IMAGE:-ccr.ccs.tencentyun.com/domonic18/aitech-hub:latest}`,服务器默认拉 TCR,本地验证 `APP_IMAGE=<local> 覆盖`;pg 口令经 `.env` 的 `POSTGRES_PASSWORD` 插值(web/worker 的 DATABASE_URL 由 compose 拼出,覆盖 .env 里的 dev 地址)
- 证书:沿用旧站 `workspace/ssl` 目录(compose 卷挂载,gitignore),文件名 letsencrypt 惯例 `fullchain.pem`/`privkey.pem`

## 5. 同服务器原位切换 runbook(切换日执行)

**前置(切换日前完成)**:生产库 mysqldump 备份;uploads 全量 tar 备份;迁移脚本以生产库为源对生产 PG 实跑且 verify 全绿;切换窗口选低峰(凌晨)。

迁移脚本生产 env 清单(密钥走 .env 不入 git):`MIGRATE_SOURCE_URL`(生产 WP MySQL 只读连接)、`MIGRATE_UPLOADS_DIR`(旧站 uploads 根目录)、`MIGRATE_TABLE_PREFIX`(默认 `wp_`,生产改过前缀才配);验收 `--phase=verify --http` 需新站服务已起(基准取 `NEXT_PUBLIC_SITE_URL`)。

| # | 步骤 | 验证 |
|---|------|------|
| 1 | 服务器拉代码与镜像:`git pull && docker compose -f docker-compose.prod.yml pull` | 镜像 sha 与 CI 一致 |
| 2 | 迁移(web 容器 entrypoint 已自动跑;复核:`docker compose -f docker-compose.prod.yml exec web npx prisma migrate deploy`,幂等);种子与 admin 同容器内执行:`exec web npx prisma db seed`、admin 建号脚本 | 台账到最新 |
| 3 | `up -d` 全栈;`curl -H 'Host: 17aitech.com' http://127.0.0.1:3000/` 与 `/api/health` | 均 200 |
| 4 | **入口切换**:443 流量从旧 Apache/WP 切到新 nginx(按生产现网入口形态:改宿主机反代 upstream 或停旧监听起新 nginx;执行前截图记录现网配置) | 见验收清单 |
| 5 | 观察期(≥1 周):旧 WP 容器与 mysql 保持运行但不再对外 | 可随时回切 |
| 6 | 下线:停 WP/Apache 容器;mysqldump 终版备份 + uploads 终版 tar 归档;compose 移除旧服务 | 备份异机存放 |

**切换验收清单**(全部通过才算切完;任一失败 → 立即回滚):

- [ ] 抽 30 篇旧文章 URL(中文编码 slug)→ 200 且正文/图片完整(脚本自动跑:`npm run qa:acceptance -- --base https://17aitech.com --count 30 --seed 20261003`;默认 base localhost:3000,同 seed 可重放)
- [ ] 抽 30 个资讯 slug → 301 /articles;`/feed/` → 301 `/feed.xml`
- [ ] 首页/列表/归档/搜索/关于 200;sitemap.xml、robots.txt、feed.xml 内容正确
- [ ] admin 密码登录 + 后台守卫可见(用户短信登录三期开启——短信资质解锁后,requirement §3.3)
- [ ] Google Search Console / 百度站长:sitemap 重新提交,无新增软 404
- [ ] Core Web Vitals 抽测(PSI 移动端)LCP < 2.5s

**回滚**:入口(反代/监听)切回旧栈 upstream(127.0.0.1:9000),分钟级;切换窗口为低峰,新 PG 侧增量(浏览计数)可忽略,记录在案即可。

## 6. 备份与恢复

| 对象 | 频率 | 方式 | 保留 |
|------|------|------|------|
| PostgreSQL | 每日 03:30(容器 cron) | `pg_dump -Fc` → `workspace/backups/` | 本地 14 天 + 每周一份拉回开发机 |
| workspace/media/ | 每周日 | rsync 增量到备份盘 | 4 版本 |
| .env / ssl | 变更时 | 手动归档(密钥不入 git) | 永久 |

恢复演练:M6 前做一次"备份 → 空目录恢复 → verify 全绿"完整演练(含 `migrate deploy` 重放)。

## 7. 观测(一期最小集)

- 容器健康:compose healthcheck + 腾讯云轻量服务器自带告警(CPU/内存/磁盘)
- 业务观测:后台 overview 页(文章/用户/浏览 Top);Search Console 与百度站长每周看一次索引/抓取错误
- 日志:pino JSON,`docker compose logs --since` 排障;worker 任务失败有死信记录

# CICD 与部署

> 本文属 `docs/standard/`(稳定规范:内容不轻易变更,随实现漂移的过程细节回 arch 文档)。
> 参照 ai-invest-assisstant 的 GitHub Actions → 腾讯云 TCR → 服务器 compose 拉取模式;叠加本项目特有的"同服务器原位切换" runbook。单体架构:一个应用镜像(web + worker 两个服务共用)。

## 1. 流水线总览(.github/workflows/ci.yml)

```
PR / push(develop, main)
├── job dockerfile-lint       hadolint 四镜像目录册(app/网关/卡片渲染/pgvector)+ 迁移载体静态断言
├── job app                   npm ci 缓存 → prettier --check → eslint → tsc --noEmit → next build + worker build → vitest 单测
├── job gateway               Python 3.11 + uv(setup-uv 锁文件缓存)→ uv run pytest services/douyin-gateway/tests(M8 批①;纯单测无网依赖)
├── job card-renderer         node 单测(validate 纯函数 + slots 真进程回归,M31)
├── job migrate-replay        起 pgvector/pgvector:pg16(M20 批①,search_embedding 迁移需 vector 扩展)→
│                             幂等重放 → migrate diff --exit-code 一致性断言(standard/01-testing §5)
└── job db-incremental-guard  origin/main 迁移集落 prod_schema → 本次增量 → 从零落 fresh_schema →
                              列/索引/约束三清单比对,断言增量路径与从零路径无漂移(§1.2)

push(develop, main)/ 手动
├── job docker-release              [依赖检查线全绿] app 镜像 buildx 构建推送 TCR
├── job docker-release-gateway      [同上] 网关镜像 buildx 构建推送 TCR(docker/gateway/Dockerfile,M8 批①)
└── job docker-release-card-renderer[同上] 卡片渲染镜像 buildx 构建推送 TCR(M31)
                                    三镜像共用 .github/workflows/release-image.yml(可复用工作流):构建推送语义只有一份,
                                    改一处漏两处的风险随之消失;tag = <branch>-<短 sha>;latest 仅 main

push(develop)
└── job deploy-staging        [依赖三镜像 job] 本机测试环境自动更新(§5.1)

push(main)
└── job deploy-production     [依赖三镜像 job + environment: production 人工审批] 生产发布(§5.1)
```

> 实装(M6,2026-10-02):`app` + `migrate-replay` + `docker-release` 三 job(见 `.github/workflows/ci.yml`)。
> docker-release 支持 `workflow_dispatch` 手动触发(首次打通 TCR 用);build 构建在镜像内完成,不设独立 build job。
> 跨境推送(美国 runner → 大陆 TCR)偶发 stall:构建步骤级超时 25 分钟,失败自动重推一次(同范例仓实测经验;gha cache 网关走 scope=gateway 独立)。
> 2026-10-04:发布线拆分为 `docker-release`(app)+ `docker-release-gateway`(网关)两个独立并行 job(仿 ai-invest-assisstant 每镜像一 job,互不拖累,失败可 re-run failed jobs 单镜像重试);触发条件/依赖门/tag 规则不变。
> 2026-10-16:两个 release job 迁 Mac mini self-hosted runner(`runs-on: [self-hosted]`,仿 acore-manager):
> GitHub 托管 runner 跨境推 TCR 偶发 stall,曾逼出本地 save/scp/load 兜底通道;自托管机直推国内 TCR 链路快且稳,兜底通道随之退役。
> 机内前置(仓外一次性,参照 acore-manager 同名设施):① 注册 self-hosted runner(repo Settings → Actions → Runners,标签含默认 `self-hosted`);② 预建持久 builder `docker buildx create --name ci-builder --driver docker-container --config ~/actions-runner/buildkitd.toml`(buildkitd.toml 配国内 docker.io 镜像源;本地缓存跨 job 复用,**弃 gha cache**;workflow 里 `docker buildx use ci-builder` 选择,不用 setup-buildx-action——它会另建临时 builder 顶掉选择)。
> Apple Silicon 构建机出 175 所需 amd64:build-push 显式 `platforms: linux/amd64`(Rosetta/QEMU 模拟,冷缓存首跑偏慢属预期;步骤级超时 25/30 分钟与登录守卫保留)。
> 首推 `continue-on-error` + 末尾 gate 裁定步(任一次尝试成功即绿):此前无 gate,首推超时→重试成功 job 仍染红,误导发布判断(run 37106851119 教训,同 acore-manager 方案收口)。

- Node 22(`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` 同范例);npm 缓存走 `cache: npm`
- husky + lint-staged 本地门禁(eslint/prettier 限改文件);CI 全量跑,双保险
- TCR 凭证走 repo secrets(`TCR_NAMESPACE`/`TCR_USERNAME`/`TCR_PASSWORD`);镜像 `ccr.ccs.tencentyun.com/domonic18/aitech-hub`;构建带 `provenance: false`(TCR 不认 OCI attestation 附加清单)

### 1.1 分支模型(2026-09-30 起,同 ai-invest-assisstant)

- 常驻分支双主干:`develop`(开发主线)+ `main`(发布线);CI 对两者 push/PR 均触发
- 功能开发:基于 develop 建 `feature/<topic>` 分支(文档 `docs/`、杂务 `chore/`、重构 `refactor/` 同规),完毕 PR 合回 develop
- 发布:develop → main 走 PR;`main` 设分支保护**禁直推**(含管理员),合入只经 PR;develop 不设保护,直推仅限小修正(约定,同参考仓)

### 1.2 迁移守卫(两道,缺一不可)

| 守卫 job | 覆盖路径 | 断言 |
| --- | --- | --- |
| `migrate-replay` | 空库 → 从零全量 | 全部迁移可应用;二次 deploy 零 pending(台账幂等);实际 schema 与 schema.prisma 一致 |
| `db-incremental-guard` | 线上 schema(主干迁移集)→ 新 schema | 增量结果与从零重放结果的**列 / 索引 / 约束**三清单完全一致(无漂移) |

- 增量守卫的基准 = `origin/main` 的迁移集:main 是发布线,生产当前跑的 schema 即由它重放而来;main ⊆ develop,故 develop 上新增的迁移落在增量侧。
- **只有从零重放是不够的**:真实的「线上 schema → 新 schema」增量路径此前从未被自动验证过——生产迁移事故正是从这条路径漏出来的(范例仓 ai-invest-assisstant 的同款守卫即由此而来)。
- 比对只取结构(列/索引/约束),不比数据、不比 pg_dump 文本(数据与格式噪声会误报);`_prisma_migrations` 是迁移台账本身,排除。
- **迁移载体是应用镜像本身**(生产 entrypoint 即跑 `prisma migrate deploy`),故 `dockerfile-lint` job 另有一道静态断言:`.dockerignore` 不得排除 `prisma/`、`docker/app/Dockerfile` 须把 `prisma/` COPY 进 runner 阶段——否则线上「迁移先行」跑的是旧迁移集。

### 1.3 镜像发布线与检查门禁(2026-11-08 起)

- 三镜像(app / 网关 / 卡片渲染)各自一个 job,共用 `.github/workflows/release-image.yml`(`workflow_call` 可复用工作流):此前三份近乎逐字复制的 job 各自记着同一批踩坑注释,改一处漏两处的风险实在——收敛成一份后语义唯一。
- 闸门在调用方:`needs: [dockerfile-lint, app, gateway, card-renderer, migrate-replay, db-incremental-guard]`,检查线任一不绿则不发镜像。
- 检查线补齐(仿 ai-invest-assisstant):Dockerfile hadolint 检查(四个镜像目录册);`app` job 增 `next build` + `worker:build` 构建门禁(此前产物只在镜像里构建,Next 路由/服务端组件写错只有到发版才暴露);`workflow_dispatch` 增 `skip_lint` / `skip_test` 开关(类型检查与迁移守卫不跳过——它们防的是「发出去才发现坏」)。
- 首推失败重试 + 末尾 gate 裁定(任一次成功即绿)的语义未变,见本节开头实装记录。

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

## 3. 镜像(docker/<image>/ 目录册)

- **镜像目录册**(2026-10-25 收编,仿 ai-invest-assisstant):全部镜像定义集中 `docker/<image>/Dockerfile`——`app/`(web+worker 同镜像)/`gateway/`/`card-renderer/`/`pgvector/`;构建上下文一律**仓库根**(Dockerfile 内 COPY 前缀即源码出处),单一根级 `.dockerignore` 服务全部上下文(子级排除用 `**/` 前缀,裸目录名只匹配根级);sidecar 源码住 `services/`(自包含:依赖/测试/契约),镜像定义不入服务目录;`docker/nginx/` 为 compose 挂载配置非镜像
- app 镜像多阶段:`deps`(npm ci)→ `builder`(next build standalone + tsc worker)→ `runner`(node:22-slim,非 root)
- **构建信息注入**(2026-10-05):`npm run build` 经 `scripts/ops/build-with-info.sh` 包装,`NEXT_PUBLIC_BUILD_REF`/`NEXT_PUBLIC_BUILD_TIME` 构建期内联客户端 bundle,页脚展示版本追踪行;CI build-args 传 `branch-sha` 与 UTC 时间,本地直跑回退 `git describe --always --dirty`(`.dockerignore` 排除 `.git`,容器内必须显式传参),均缺省页脚显示 dev
- 产物:`.next/standalone` + `.next/static` + `dist/`(worker 编译产物,tsconfig.worker outDir,入口 `dist/worker/index.js`)+ `prisma/`(migrate 需 schema)+ `scripts/` 与 `src/`(ops 脚本如 `npm run admin` 以 tsx 直跑,依赖 src 源码;显式整拷,勿依赖 standalone 追踪);entrypoint 按 `SERVICE_ROLE=web|worker` 区分启动目标
- `.dockerignore` 排除 `.env`/`docs`/`tests`/`media`/`workspace`/`CLAUDE.md`/`Makefile`/`docker-compose*.yml`(仓库与运维文件不进构建上下文)
- **媒体目录不打进镜像**:compose 卷挂载,独立于发版
- **apt 源换国内镜像(2026-11-08,三镜像统一)**:三个镜像的基座(node:20/22-slim、python:3.11-slim)的 deb822 源指向 `deb.debian.org`(明文 80),国内构建机常连不通——2026-11-04 实测卡渲染镜像 `fonts-noto-cjk` 拉取被拒(`exit 100`),两次重试皆败 → 镜像没进 TCR、develop 发布线全红。app 镜像另有一条境外源 `apt.postgresql.org`(装 postgresql-client-16,bookworm 缺省 client 15 < 服务端 16)。处置:`docker/<image>/Dockerfile` 统一加 `ARG APT_MIRROR_HOST`(默认 `mirrors.aliyun.com`,sed 改写 `/etc/apt/sources.list.d/debian.sources` 的 debian 与 debian-security 两条 URI)+ app 的 `ARG PGDG_MIRROR`(默认 `https://mirrors.aliyun.com/postgresql/repos/apt`,签名 key 不变——同一仓库);**置空即回退官方源**(境外构建机显式覆盖)。换源写在装包之前,`playwright install --with-deps` 内部那次 apt 同样走镜像。手法与既有的 `FFMPEG_BINARIES_URL` / `PRISMA_ENGINES_MIRROR` 同一路子(境外二进制/源统一走国内镜像),但本次是**默认值直接给国内镜像**,故 compose 不必再传 build-args。

### 3.1 构建期无 DB 降级与启动预热(2026-09-30 实测定型)

- builder 无 env/DB:`ENV` 占位三件套(DATABASE_URL/REDIS_URL/AUTH_SECRET)过 Zod 校验;预渲染取数经 `lib/prerenderSafe`(仅 `NEXT_PHASE=phase-production-build` 生效)降级为空数据,**运行时 ISR 错误照常上抛不吞**
- 降级产物在 revalidate 窗口内不会自动再生 → entrypoint 起服后后台跑 `scripts/warm-isr.mjs`(`node ./scripts/warm-isr.mjs &`):轮询 `/api/health/` 就绪 → `POST /api/internal/revalidate/`(AUTH_SECRET 派生 token,`revalidatePath("/", "layout")` + SEO 路由全量失效)→ 逐路径双 fetch(首触发再生、次取新鲜产物入缓存);失效端点勿删,预热失败不阻塞启动
- **预热路由清单单一来源**(2026-11-01):`src/lib/seo/warm-routes.json` 同时被 `src/lib/seo/routes.ts`(`WARM_ROUTES`,服务端)与 `scripts/warm-isr.mjs`(容器内 node,无 tsconfig 故用 JSON 而非 TS)读取;`routes.test.ts` 断言 SEO 出口全在清单内、页面路由带尾斜杠。新增可预热路由只改 JSON,不必再动 entrypoint
- 实测踩坑(均已修,勿回退):
  - runner 的 node_modules 必须取 **builder 层**(含 `prisma generate` 产物;取 deps 层会覆盖 standalone 内 traced 生成物,运行时报 `client did not initialize`)
  - `HOSTNAME=0.0.0.0` 必须显式设——容器 HOSTNAME 是容器 ID,Next standalone 会当绑定地址,回环拒连(预热 ECONNREFUSED)
  - slim 无 openssl,deps/runner 需 apt 安装(prisma 引擎探测)
  - worker:build 须接 `tsc-alias`(`@/` 别名 emit 不改写,产物运行时崩)
  - healthcheck 打 `/api/health/`(trailingSlash 308;compose 探针需带尾斜杠或 `-f` 跟随)
  - 预热不能用「固定 sleep 后单发 POST」:2C 冷启动 server 绑定可晚于 sleep,POST 落空且被吞、无任何日志;页面靠短 revalidate(600s)自然自愈,feed/sitemap(3600s)空壳挂满窗口(2026-10-03 生产实测定诊)——就绪轮询 + 重试 + 双 fetch,见 entrypoint
  - ops 脚本依赖的 src 必须**显式 COPY**:standalone 追踪对源码只带碎片(2026-10-03 实测 `src/lib/auth/` 仅剩 `*.test.ts`,生产镜像 `npm run admin` 必 MODULE_NOT_FOUND);`scripts/`、`src/` 勿依赖追踪带入
  - 定属主用 `COPY --chown`,勿 `RUN chown -R /app`:后者把已拷内容整层 CoW 复制一遍,实测多出 1.08GB 层(镜像层只增不删)

### 3.2 网关镜像(docker/gateway/Dockerfile,M8 批①)

- 独立第二镜像 `aitech-hub-gateway`:`python:3.11-slim` 单阶段,pip 引导 uv 按 `uv.lock` 精确装依赖(`--frozen`,2026-10-25 自 requirements*.txt 迁移 pyproject+uv.lock)后 `playwright install --with-deps chromium`(签名驱动,含系统依赖层,镜像偏大属预期);与主镜像零共享,单一根级 `.dockerignore` 服务全部上下文(源码住 `services/douyin-gateway/`,镜像定义收编 `docker/gateway/`)
- CI 与主镜像各自独立 job 并行构建推送(`docker-release-gateway`,2026-10-04 起;各带重推重试,互不拖累);tag 规则同款 `<branch>-<短 sha>` + `latest` 仅 main
- prod compose 服务 `douyin-gateway`:`image: ${GATEWAY_IMAGE:-…aitech-hub-gateway:latest}`,内网无 ports(worker 经服务名 `http://douyin-gateway:8010` 访问,`x-app-env` 注 `DOUYIN_GATEWAY_URL`);tmpfs 挂 `/tmp/playwright-profiles`(chromium Profile 防容器层写放大);healthcheck urllib 探 `/health`(slim 无 curl 同款问题),`start_period: 60s`(首启含 chromium 拉起);`mem_limit: 1g` + `DOUYIN_SIGNER_WARM_SLOTS: 1`(warm 页吃内存,2C4G 预算钉死单槽)
- dev compose 走 `--profile douyin` 按需起(build 本地,`127.0.0.1:8010` 仅回环,便于 curl 冒烟),不影响日常 pg/redis 起;契约见 arch/05 §4.4
- **网关镜像升级步骤**(契约护栏):黄金样本双侧对拍已进 CI(pytest `test_contract_fixtures.py` + vitest `gateway-contract.test.ts`),升级后另跑一次实弹对拍——`docker compose --profile douyin up -d douyin-gateway` 起本地网关,`npm run test:integration`(gateway 未起自动跳过;真实拉取对拍设 `DOUYIN_INTEGRATION_SEC_UID`/`DOUYIN_INTEGRATION_SHARE_URL` 开启)
- 镜像现状 ≈2.4GB → 消除 chown 复制层后 ≈1.4GB(runner 全量 node_modules 为既有取舍:worker 与 prisma CLI 同镜像所需——web 启动即跑 `npx prisma migrate deploy`,CLI 必须在);进一步瘦身方向:`npm ci --omit=dev` 拆 prod-deps 层 + tsx 入 dependencies,非一期阻塞(2026-10-03 评估)

### 3.3 PG pgvector 镜像(M20 批①,docker/pgvector/Dockerfile)

- **为什么自编译**:dev/prod PG 现网 postgres:16-alpine(musl),`datcollversion` 为 NULL(musl 不记录 collation 版本);官方 `pgvector/pgvector` 镜像是 Debian(glibc)——原位换镜像 = 既有 PGDATA 文本排序**静默**变更(locale 无版本锚,不报错),禁用官方镜像直换现网。自编译 = postgres:16-alpine 基座 + 源码编 pgvector v0.8.7(`make with_llvm=no`——alpine pgxs 缺省要 clang 出 LLVM bitcode,构建必挂),基座不变零 collation 风险;CI 迁移重放库无历史数据,直接用官方 `pgvector/pgvector:pg16` 无碍
- 构建推送(175 无 buildx 不能构建,本机出):`docker build --platform linux/amd64 -t <TCR>/<namespace>/aitech-hub-pgvector:pg16 docker/pgvector` → `docker save | ssh <prod> docker load` → 服务器内网 `docker tag` + `docker push` TCR(内网秒级);本机直推 TCR 无权限
- compose:dev postgres `build: {context: ./docker/pgvector}`(卷 `./workspace/postgres-dev`,dev/prod 卷禁共挂);prod 引 TCR `aitech-hub-pgvector:pg16`
- **175 换 PG 容器 runbook(M20 部署批执行,变更操作先批准;实参以 `docker inspect` 旧容器为准)**:①`pg_dump` 全量安全留档 → ②`docker stop`+`docker rm` 旧 postgres(数据卷 `workspace/postgres` 不动)→ ③`docker run` 同参重建(仅镜像换 pgvector 版;挂载/端口/env 逐项对齐)→ ④`psql -c "CREATE EXTENSION IF NOT EXISTS vector"` 验证 → ⑤部署新版应用镜像(启动即 `migrate deploy` 落 `search_embedding` 表)→ ⑥admin 绑定 embedding-3 → `npm run embed:run` 回填 → ⑦线上混合检索抽查(含降级:停绑定后纯词项回归)

## 4. 生产拓扑与 Nginx(compose 服务)

实现落位 `docker-compose.prod.yml`(project 名 `aitech-hub-prod`,与 dev compose 同机互不干扰):

```
nginx        80/443(唯一对外;SSL 终结,证书卷挂载 workspace/ssl;80 全量 301 https)
  ├── /wp-content/uploads/*  → COS 媒体桶反代(M19 批④,URL 不变;proxy_cache 2g/365d;
  │                            静态 proxy_pass 原始 URI 透传,桶 key 与 URL 路径同构,arch/08 §1)
  ├── /feed、/feed/          → 301 /feed.xml(nginx 层)
  └── 其余全量反代 web:3000(原始请求串原样透传,中文编码 slug 不经 nginx 归一化)
web:3000     内网 + 宿主回环发布 127.0.0.1:3000(切换日 runbook curl 验证用)
worker       仅内网(同镜像,SERVICE_ROLE=worker;媒体卷读写 + backups/ssl 卷,db-backup M19)
douyin-gateway  仅内网(独立网关镜像;无 ports,worker 经服务名 :8010 访问;M8 批①,§3.2)
redis / postgres  仅内网,不发布端口(redis 开 AOF + 数据卷)
```

- **legacy 兜底差异(实现沉淀)**:兜底已前移到应用层路由——单段旧路径由 `(site)/[slug]` 页承接,`/category/*`、`/tag/*` 页内 fallback,`/legacy/[...path]` 路由保留;实测 `legacy_url_map` 内多段路径仅 3 条且全落在专用路由,nginx 无需 error_page 拦截(还会误伤 API 404)
- **媒体直服两个 nginx 坑(实测沉淀,M6)**:①磁盘文件名为 percent-encoded(与应用侧 normalizeUrlPath 同因),`alias` 按解码后 URI 找文件必 404 → 用 `map $request_uri` 取未解码原始串拼路径;②alias 带变量时 nginx 仍追加"location 匹配后剩余 URI(已解码)",location 必须正则吃满整个 URI。M19 批④ 反代后该组坑整体消解:静态 `proxy_pass`(无 URI)对原始请求串零处理透传,COS 服务端 decode 一次即命中(桶 key 与 URL 路径同构)
- **站点 conf 模板化(M19 批④)**:`docker/nginx/templates/aitech-hub.conf.template` 经 nginx 官方镜像 templates 机制启动时 envsubst 生成(仅替换已定义环境变量,nginx `$var` 原样保留),消费 `COS_MEDIA_HOST`(.env);镜像自带 default.conf 由 `conf.d/default.conf.mask` 文件级挂载顶替;`workspace/media` ro 挂载保留为回滚通道
- **COS(M19)**:媒体桶(MEDIA_STORAGE=cos 时 web/worker 读写;nginx 匿名反代读)+ 备份桶(db-backup 每日 03:23);地域与服务器同域走内网;密钥子账号最小权限仅 `.env`;桶 lifecycle 一次性设置已完成(备份 30 天/杂项 90 天;cos-setup 脚本 2026-10-09 随迁移完结清理,git 历史可查)
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

- [ ] 抽 30 篇旧文章 URL(中文编码 slug)→ 200 且正文/图片完整(脚本自动跑:`npm run qa:acceptance -- --base https://17aitech.com --count 30 --seed 20261003`;qa 脚本 2026-10-09 已从仓库清理,重放自 git 历史恢复;默认 base localhost:3000,同 seed 可重放)
- [ ] 抽 30 个资讯 slug → 301 /articles;`/feed/` → 301 `/feed.xml`
- [ ] 首页/列表/归档/搜索/关于 200;sitemap.xml、robots.txt、feed.xml 内容正确
- [ ] admin 密码登录 + 后台守卫可见(用户短信登录三期开启——短信资质解锁后,requirement §3.3)
- [ ] Google Search Console / 百度站长:sitemap 重新提交,无新增软 404
- [ ] Core Web Vitals 抽测(PSI 移动端)LCP < 2.5s

**回滚**:入口(反代/监听)切回旧栈 upstream(127.0.0.1:9000),分钟级;切换窗口为低峰,新 PG 侧增量(浏览计数)可忽略,记录在案即可。

### 5.1 自动部署(2026-11-08 起,scripts/deploy.sh)

部署逻辑只有 `scripts/deploy.sh` 一份(可评审、可回溯),CI 不内联长命令:

```bash
bash scripts/deploy.sh --env staging --tag develop-<sha>
sudo bash scripts/deploy.sh --env prod --tag main-<sha>
```

流程:参数校验(tag 白名单正则,杜绝 `latest` 误传)→ 预检(docker / compose / env 文件 / 磁盘余量 / postgres 健康)→ env 文件备份轮转 + 钉镜像 tag → 拉镜像 → **迁移先行** → 换容器 → 健康检查 → 落 `.deploy-state` → 失败自动回滚 → 镜像清理(每仓库保留最新 3 个,只清悬空层,绝不 `prune -a`)。

- **迁移先行**:迁移载体就是应用镜像(生产 entrypoint 即 `prisma migrate deploy`),脚本用新镜像的容器跑一次 `prisma migrate deploy`(绕开 entrypoint 只跑迁移)。迁移失败即中止发布,**旧容器继续服务**——与独立 migrate 镜像同语义。
- **回滚**:三个镜像的 tag 钉在 env 文件的 `APP_IMAGE` / `GATEWAY_IMAGE` / `CARD_RENDERER_IMAGE`(compose 已按这三个变量插值);回滚 = 退回上一份 env 文件再起一次(三个 tag 一并回退,避免组合版本错位),失败现场保留(`.deploy-state` 记状态)。
- **staging 与 prod 共用 `docker-compose.prod.yml`,靠三处隔离**:测试环境的部署根目录**就是本仓工作副本**(仓库变量 `DEPLOY_ROOT` 指向它;此前另开一份部署目录,项目进入小功能迭代后不再需要),隔离靠:`COMPOSE_PROJECT_NAME=aitech-hub-staging` + 独立 env 文件(`.env.staging`,开发态仍是 `.env`)+ 独立数据目录(`workspace-staging/`,开发态仍是 `workspace/`)。prod 全栈(带 nginx);staging 不起 nginx(无 SSL 证书)。web 的宿主回环端口参数化为 `WEB_HOST_PORT`(staging 取 3001,与本机 `next dev` 的 3000 并存)。
- **测试环境与开发环境同目录的纪律**:CI **不往工作副本写任何文件**(只落 `.deploy-commit`),否则会覆盖本地未提交改动;compose 与部署脚本取工作副本里的版本,应用代码取 CI 构建的镜像——故工作副本 HEAD 与发布 commit 不一致时 CI 只发 `::warning::` 而不失败。
- **env 文件按环境选择**:脚本按 `--env` 决定用哪个 env 文件(staging `.env.staging` / prod `.env`),备份轮转、镜像钉、回滚目标全部按该文件走,两环境互不干扰;compose 的插值与容器的 `env_file` 指向同一个文件(`APP_ENV_FILE`),不会出现「插值用一套、容器用另一套」。
- **测试环境 env 文件的必备项**:compose 对整个文件做插值(staging 不起 nginx 也一样),故 `.env.staging` 里 `COS_MEDIA_HOST` 必须有值(填占位串即可,staging 不起 nginx);其余按 `.env.example` 补齐,`POSTGRES_PASSWORD` / `AUTH_SECRET` 各自独立于开发态。
- **基础设施由脚本自己拉起**:预检要求 postgres 在线(迁移要连库),故 postgres 容器不存在时预检就地 `compose up -d --wait postgres` 起它——部署入口只有脚本一个,人不必先手工铺一遍基础设施。换容器用 `--pull never`,故 postgres / redis 镜像在拉镜像阶段一并拉取(它们的 tag 与本次发布无关:pgvector 自编译镜像固定 `pg16`、redis 固定 `7-alpine`)。
- 生产机不执行仓库代码:CI 只以受限参数(环境名 + tag)调用服务器上那份已评审的 `scripts/deploy.sh`;两次 SSH 调用顺序不可颠倒——先把新资产送到服务器,再执行部署。

**实测记录(2026-11-08,PR #227 合并 develop 后首次由 CI 驱动的测试环境更新)**:检查线六道守卫全绿(含新增的 hadolint 与迁移增量守卫)→ 三镜像构建推送 TCR 全绿(**卡渲染镜像此前正是卡在 apt 源,换国内镜像后首次通过**)→ `deploy-staging` 依次完成预检(磁盘余量)→ 钉 tag(`develop-1387dfd`,记上一版本 `develop-0c3eed9` 作回滚目标)→ 拉镜像 → 迁移先行(`prisma migrate deploy` 先行且幂等,web 启动时复核 `No pending migrations to apply`)→ 换容器 → 健康检查 → 落 `.deploy-state`(`status=OK`)→ 镜像清理(每仓库保留最新 3 个),全程约 70 秒;三个应用容器跑 CI 刚构建的同一 tag,页脚构建信息显示 `develop-1387dfd`(build-meta 经可复用工作流注入未丢),开发态 `.env` 未被污染。

**生产发布路径实测(2026-11-08,PR #228 合并 main 后的首次生产发布)**:托管 runner → 生产机 SSH 链路**成立**(此前未实证);但连续两次失败,暴露两处真实缺口,均已修:

1. **生产机缺 compose v2 CLI 插件**:该机只装了独立二进制 `/usr/local/bin/docker-compose`,`docker compose` 不可用 → 现场记录步以 `exit 125`(unknown shorthand flag: 'f')崩掉,报错指向"拉取失败"实为环境缺失。已补装插件(`/usr/libexec/docker/cli-plugins/docker-compose` 软链,系统级、root 与普通用户均可),并在 CI 加**生产机预检步**(部署目录存在 + `sudo docker compose version` 可用),缺插件时明确报错、不半途发布。脚本自身的预检本就查 `docker compose version`,只是 CI 的现场记录步跑在脚本之前,先炸在那里。
2. **镜像坐标推导剥错了段数**:`image_namespace()` 误把 `/namespace/repo:tag` 两段一起剥掉,返回的是 registry 而非命名空间,拼出 `registry/registry/repo`(三段齐全,段数校验查不出)。staging 因 CI 传了 `DEPLOY_NAMESPACE` 而幸免,生产 job 没传 → 拉镜像全数 `pull access denied`。已改为只剥末段 `repo:tag` 再剥 registry 前缀;同时 CI 显式把 `DEPLOY_NAMESPACE` 随 ssh 命令传到服务器侧脚本(ssh 不继承 runner 的 env),并在主 shell 的调用点加三段式 + registry 不重复的坐标校验(校验不能放在命令替换里——那里的 `exit` 只退子 shell,报错会被吞掉)。

**两次失败均未伤及生产**:第一次炸在现场记录步(未触及任何生产变更),第二次炸在拉镜像(钉 tag 后即失败,脚本自动退回上一份 `.env`,三个 tag 一并回退);全程生产仍跑旧 tag、容器无重启、`APP_IMAGE` 与实际运行镜像一致——**回滚通道与"失败即中止、旧容器继续服务"的语义经实测成立**。

**仓外一次性配置**(命名与 ai-invest-assisstant 逐字一致;仓库为 public,主机地址与部署路径一律走仓库变量,不入库):

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `TCR_NAMESPACE` / `TCR_USERNAME` / `TCR_PASSWORD` | repo secret | 镜像仓库凭证 |
| `DEPLOY_SSH_KEY` / `DEPLOY_KNOWN_HOSTS` | repo secret | 免密私钥与主机指纹 |
| `DEPLOY_HOST` / `DEPLOY_PATH` | repo variable | 生产机 SSH 目标与部署目录 |
| `DEPLOY_ROOT` | repo variable | 测试环境部署根目录(= 本仓工作副本;该目录须先备好 `.env.staging`) |

- **与参考仓的一处刻意分歧**:ai-invest 把 `DEPLOY_HOST` / `DEPLOY_PATH` / `DEPLOY_ROOT` 直接硬编码在 workflow YAML 里——它同样是 public 仓,等于公开主机 IP 与用户名路径。本仓 CLAUDE.md 明令公开仓不写真实 IP 与 SSH 路径,故**名字照抄、值改走 repo variables**(值在 GitHub 设置里,不入库)。secret 侧两边完全相同。
- `environment: production` 的审批规则在仓库 Settings → Environments 配(required reviewer);**未配 secret / 变量时 deploy job 在前置校验步明确失败**,不会半途发布。

## 6. 备份与恢复(M19 起落 COS 异机存放)

| 对象 | 频率 | 方式 | 保留 |
|------|------|------|------|
| PostgreSQL | 每日 03:23(worker BullMQ `db-backup`,M19 批②) | `pg_dump -Fc` → `workspace/backups/` → 上传备份桶 `backups/db/` | 本地 3 份 + 桶侧 lifecycle 30 天 |
| workspace/ssl | 每日(随 db-backup 顺带) | tar → 备份桶 `backups/misc/ssl-<date>.tgz` | 桶侧 lifecycle 90 天 |
| workspace/media/ | M19 批③ 起 | 媒体桶即异机副本(全量迁移,upload 幂等续传);本地卷保留为反代回滚通道 | 桶侧永久(immutable,不设 lifecycle) |
| .env | 变更时 | 手动归档(密钥不入 git 不入桶) | 永久 |

- Redis 不备份:队列与调度器 upsert 幂等自愈,数据语义可重建。
- 桶初始化(新环境一次性):cos-setup 脚本已随 M19 完结清理(git 历史可查)——在 COS 控制台手工设 lifecycle(备份桶 30 天/杂项 90 天),或自 git 历史恢复脚本执行(含双桶连通探测)。
- dump 文件名 `aitech_hub-<YYYYMMDD-HHmm>.dump`,字典序即时间序,桶内取"最大名"即最新。

**恢复步骤**(演练与真灾同序;演练 = 本机空 PG 容器走一遍,M19 批⑤):

1. 取最近 dump:备份桶 `backups/db/` 下载最新对象(控制台或 SDK 列举)
2. 起空 PG(与服务端同 major):`docker run -d --name restore-drill -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:16`
3. 恢复:`pg_restore -h localhost -p 55432 -U postgres -d postgres --no-owner --no-privileges --clean --if-exists <dump>`
4. 校验:指向该库跑 `npx prisma migrate deploy`(台账应零 pending)+ 关键表行数抽查(`content_post`/`content_media`/`user` 对比生产)
5. 演练通过记录日期与结果;真灾时把 compose `DATABASE_URL` 指向恢复库重启即服务

手动触发(不等 03:23):`npm run backup:run`(入队即轮询到终态)→ 桶内见 dump → 走 2-4 步。

## 7. 观测(一期最小集)

- 容器健康:compose healthcheck + 腾讯云轻量服务器自带告警(CPU/内存/磁盘)
- 业务观测:后台 overview 页(文章/用户/浏览 Top);Search Console 与百度站长每周看一次索引/抓取错误
- 日志:pino JSON,`docker compose logs --since` 排障;worker 任务失败有死信记录

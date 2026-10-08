# 多阶段构建(standard/02-cicd-deployment §3):deps → builder → runner
# 同一镜像双角色:SERVICE_ROLE=web|worker 由 entrypoint 区分启动目标
FROM node:22-slim AS deps
WORKDIR /app
# ffmpeg-static postinstall 从 github release 拉 Linux 二进制;docker VM 直连
# github 常 reset(2026-10-05 实测)——本机构建经 docker-compose.prod.yml 默认注入
# npmmirror 镜像源,纯 docker build 需显式 --build-arg;空值回退默认 github,CI 无感
ARG FFMPEG_BINARIES_URL=""
ENV FFMPEG_BINARIES_URL=$FFMPEG_BINARIES_URL
# npm fetch 容错(2026-10-05 本机 VM 出网抖动实测:长传输间歇 ECONNRESET):
# 放宽重试次数/超时;npm 缓存挂 BuildKit cache 挂载,构建失败重试时已下载的
# tarball 跨构建累计,只补缺口(CI 网络稳定,行为无差)
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=600000
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-slim AS builder
WORKDIR /app
# prisma 引擎探测依赖 openssl(slim 缺省无,缺了仅告警但按错误路径运行)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# 构建占位 env:env 模块 import 即 Zod 校验;预渲染取数经 prerenderSafe
# 降级为空数据(lib/prerender-safe.ts),产物按需 ISR,不真连这两个地址
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    AUTH_SECRET=build-time-placeholder-0123456789abcdef
# 构建信息注入(CI build-args 传入;.dockerignore 已排除 .git,容器内无法 git describe):
# NEXT_PUBLIC_ 前缀构建期内联进客户端 bundle,Footer 展示版本追踪行
ARG BUILD_REF=""
ARG BUILD_TIME=""
ENV NEXT_PUBLIC_BUILD_REF=$BUILD_REF \
    NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npm run worker:build

FROM node:22-slim AS runner
ENV NODE_ENV=production \
    SERVICE_ROLE=web \
    PORT=3000 \
    TZ=Asia/Shanghai \
    # Next standalone 会把 HOSTNAME 当绑定地址;容器里该 env 是容器 ID,
    # 不固定为 0.0.0.0 会只监听 eth0、本地回环(预热)拒连
    HOSTNAME=0.0.0.0
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl curl ca-certificates gnupg \
  # pgdg 源装 postgresql-client-16(db-backup 每日 pg_dump;bookworm 缺省 client 15 < 服务端 16,
  # 版本不齐 pg_dump 拒跑);M19 批②
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs next

# standalone 产物 + 静态资源 + worker 编译产物 + prisma(migrate 需 schema)
# + scripts/src(ops 脚本如 npm run admin 以 tsx 直跑,依赖 src 源码;
#   standalone 追踪只带碎片——实测 src/lib/auth 仅剩 *.test.ts,不能依赖)
# COPY --chown 在拷贝时定属主,替代 RUN chown -R(后者对已拷内容整层
# CoW 复制一遍,实测多出 1.08GB 层)
COPY --from=builder --chown=next:nodejs /app/.next/standalone ./
COPY --from=builder --chown=next:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=next:nodejs /app/public ./public
COPY --from=builder --chown=next:nodejs /app/dist ./dist
COPY --from=builder --chown=next:nodejs /app/prisma ./prisma
COPY --from=builder --chown=next:nodejs /app/scripts ./scripts
COPY --from=builder --chown=next:nodejs /app/src ./src
# worker 依赖与 @prisma/client 生成物必须取 builder(node_modules 含
# prisma generate 产物;取 deps 层会覆盖 standalone 内 traced 生成物,
# 运行时报 "client did not initialize")
COPY --from=builder --chown=next:nodejs /app/node_modules ./node_modules
COPY --chown=next:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER next
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]

# 多阶段构建(07 文档 §3):deps → builder → runner
# 同一镜像双角色:SERVICE_ROLE=web|worker 由 entrypoint 区分启动目标
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

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
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs next

# standalone 产物 + 静态资源 + worker 编译产物 + prisma(migrate 需 schema)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# worker 依赖与 @prisma/client 生成物必须取 builder(node_modules 含
# prisma generate 产物;取 deps 层会覆盖 standalone 内 traced 生成物,
# 运行时报 "client did not initialize")
COPY --from=builder /app/node_modules ./node_modules
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R next:nodejs /app

USER next
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]

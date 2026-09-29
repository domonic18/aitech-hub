# 多阶段构建(07 文档 §3):deps → builder → runner
# 同一镜像双角色:SERVICE_ROLE=web|worker 由 entrypoint 区分启动目标
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npm run worker:build

FROM node:22-slim AS runner
ENV NODE_ENV=production \
    SERVICE_ROLE=web \
    PORT=3000 \
    TZ=Asia/Shanghai
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs next

# standalone 产物 + 静态资源 + worker 编译产物 + prisma(migrate 需 schema)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/worker-dist ./worker-dist
COPY --from=builder /app/prisma ./prisma
# worker 依赖(bullmq/ioredis/pino/@prisma client 运行时);与 standalone 并存
COPY --from=deps /app/node_modules ./node_modules
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R next:nodejs /app

USER next
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]

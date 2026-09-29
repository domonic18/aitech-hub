#!/usr/bin/env bash
# 本地一键初始化(00 文档 §6 / 07 文档 §2):env → 依赖 → pg/redis → 迁移 → 种子
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ 已从 .env.example 创建 .env"
fi

# AUTH_SECRET 仍为空占位则自动生成
if grep -q '^AUTH_SECRET=$' .env; then
  secret=$(openssl rand -base64 32)
  sed -i.bak "s|^AUTH_SECRET=$|AUTH_SECRET=${secret}|" .env && rm -f .env.bak
  echo "→ 已生成 AUTH_SECRET"
fi

echo "→ npm install"
npm install

echo "→ 启动 postgres(5434)/ redis(6380)"
docker compose up -d postgres redis

for svc in aitech_hub_pg aitech_hub_redis; do
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$svc" 2>/dev/null)" = "healthy" ]; do
    sleep 1
  done
  echo "→ $svc healthy"
done

echo "→ prisma migrate deploy"
npx prisma migrate deploy

echo "→ seed"
npm run seed

echo ""
echo "✅ setup 完成。make dev 启动后访问 http://localhost:3000/api/health 验证。"

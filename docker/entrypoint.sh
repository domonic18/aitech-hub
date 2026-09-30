#!/bin/sh
set -e

case "$SERVICE_ROLE" in
  web)
    # 起应用前确保 schema 最新(arch/03-data-model §1:起库健康后、起应用前必须执行)
    npx prisma migrate deploy
    # ISR 预热:镜像构建期无 DB,静态页为降级空产物(prerenderSafe),
    # 且 revalidate 窗口内不会自动再生——先调内部端点 on-demand 全量失效
    # (AUTH_SECRET 派生 token,见 api/internal/revalidate),再逐路径触发
    # 同步再生;失败不阻塞启动
    (
      sleep 3
      TOKEN=$(node -e "console.log(require('node:crypto').createHash('sha256').update(process.env.AUTH_SECRET + ':revalidate').digest('hex'))")
      node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/internal/revalidate/',{method:'POST',headers:{'x-internal-token':'$TOKEN'}}).catch(() => {})" || true
      for p in / /articles/ /archive/ /sitemap.xml /feed.xml /llms.txt /llms-full.txt; do
        node -e "fetch('http://127.0.0.1:${PORT:-3000}$p').catch(() => {})" || true
      done
    ) &
    exec node server.js
    ;;
  worker)
    exec node dist/worker/index.js
    ;;
  *)
    echo "SERVICE_ROLE must be web or worker, got: $SERVICE_ROLE" >&2
    exit 1
    ;;
esac

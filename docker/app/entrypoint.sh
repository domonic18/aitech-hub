#!/bin/sh
set -e

case "$SERVICE_ROLE" in
  web)
    # 起应用前确保 schema 最新(arch/03-data-model §1:起库健康后、起应用前必须执行)
    npx prisma migrate deploy
    # ISR 预热:镜像构建期无 DB,静态页为降级空产物(prerenderSafe),
    # 且 revalidate 窗口内不会自动再生——先调内部端点 on-demand 全量失效
    # (AUTH_SECRET 派生 token,见 api/internal/revalidate),再逐路径触发
    # 同步再生;失败不阻塞启动。
    # 不能用固定 sleep 后单发:冷启动下 server 绑定可能晚于 sleep,POST 落空
    # 且被吞(2026-10-03 实测:feed/sitemap 空壳挂满 1h revalidate 窗口)——
    # 先轮询 /api/health/ 就绪,POST 失败重试,再逐路径双 fetch(首触发再生、
    # 次 fetch 取新鲜产物入缓存)
    (
      i=0
      until node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/health/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
        i=$((i + 1)); [ "$i" -ge 30 ] && break
        sleep 2
      done
      TOKEN=$(node -e "console.log(require('node:crypto').createHash('sha256').update(process.env.AUTH_SECRET + ':revalidate').digest('hex'))")
      j=0
      until node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/internal/revalidate/',{method:'POST',headers:{'x-internal-token':'$TOKEN'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
        j=$((j + 1)); [ "$j" -ge 5 ] && break
        sleep 2
      done
      for p in / /articles/ /archive/ /sitemap.xml /feed.xml /llms.txt /llms-full.txt; do
        node -e "fetch('http://127.0.0.1:${PORT:-3000}$p').catch(() => {})" || true
        sleep 1
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

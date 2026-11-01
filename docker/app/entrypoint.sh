#!/bin/sh
set -e

case "$SERVICE_ROLE" in
  web)
    # 起应用前确保 schema 最新(arch/03-data-model §1:起库健康后、起应用前必须执行)
    npx prisma migrate deploy
    # ISR 预热:镜像构建期无 DB,静态页为降级空产物(prerenderSafe),
    # 且 revalidate 窗口内不会自动再生——起服后交给 scripts/warm-isr.mjs
    # 做「等健康 → 全量失效 → 逐路径双 fetch」。路由清单与 src/lib/seo/
    # warm-routes.json 单一来源,新增可预热路由不必再改本文件。
    # 后台执行且失败不阻塞启动。
    node ./scripts/warm-isr.mjs &
    # M48 批A①:容器 mem_limit 下显式钉堆上限——V8 缺省按宿主机内存推断老生代,
    # 容器内失准,可远超 cgroup 上限才触发 GC → 内核 OOM 硬杀绕过优雅路径
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=512"
    exec node server.js
    ;;
  worker)
    # M48 批A①:容器 mem_limit 下显式钉堆上限——V8 缺省按宿主机内存推断老生代,
    # 容器内失准,可远超 cgroup 上限才触发 GC → 内核 OOM 硬杀绕过优雅路径;
    # worker 另有 sharp 原生内存不走 V8 堆,堆占比再让一档(512m limit → 384 堆)
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=384"
    exec node dist/worker/index.js
    ;;
  *)
    echo "SERVICE_ROLE must be web or worker, got: $SERVICE_ROLE" >&2
    exit 1
    ;;
esac

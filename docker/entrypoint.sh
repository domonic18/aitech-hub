#!/bin/sh
set -e

case "$SERVICE_ROLE" in
  web)
    # 起应用前确保 schema 最新(02 文档 §1:起库健康后、起应用前必须执行)
    npx prisma migrate deploy
    exec node server.js
    ;;
  worker)
    exec node worker-dist/worker/index.js
    ;;
  *)
    echo "SERVICE_ROLE must be web or worker, got: $SERVICE_ROLE" >&2
    exit 1
    ;;
esac

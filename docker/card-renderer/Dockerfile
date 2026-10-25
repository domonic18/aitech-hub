# card-renderer(M31 批A):HTML→PNG 专职渲染 sidecar;仅容器网内,web 经 CARD_RENDERER_URL 调用。
# 源码住 services/card-renderer/(自包含:lockfile/单测);镜像定义收编 docker/ 目录册
# 构建上下文 = 仓库根(COPY 前缀即源码出处)
FROM node:20-slim

# Noto CJK:中文渲染不豆腐;Noto Color Emoji:emoji 彩色呈现;
# chromium 运行时系统库由 playwright install --with-deps 自装(与 douyin-gateway 同法)
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=8011 \
  MEDIA_ROOT=/app/media \
  PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

WORKDIR /app

# 依赖层:跳过 postinstall 全量浏览器下载,只装 chromium 一款(npm ci 需 lockfile)
COPY services/card-renderer/package.json services/card-renderer/package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY services/card-renderer/index.js services/card-renderer/validate.js ./

# 媒体卷由 compose ro 挂载到 /app/media(MEDIA_ROOT);--no-sandbox 为容器内 chromium 必需
EXPOSE 8011
CMD ["node", "index.js"]

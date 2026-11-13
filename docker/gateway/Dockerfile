# 抖音数据网关:签名(Playwright chromium 常驻页)+ 数据端点(curl_cffi Chrome TLS 指纹)
# 源码住 services/douyin-gateway/(自包含:pyproject+uv.lock/tests/契约);镜像定义收编 docker/ 目录册
# 构建上下文 = 仓库根(COPY 前缀即源码出处);内网 only:compose 不发布端口,本地冒烟 dev compose 映射 127.0.0.1:8010
FROM python:3.11-slim

# venv bin 前置:uvicorn/playwright 解析到项目虚拟环境(.venv 由 uv sync 创建)
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    PATH="/srv/.venv/bin:${PATH}"

WORKDIR /srv

# apt 源:基座镜像的 deb822 源指向 deb.debian.org(明文 80),国内构建机常连不通
# (2026-11-04 实测:同批 CI 的卡渲染镜像即栽在这里)。默认换国内镜像;置空回退官方源。
# 换源写在 playwright install --with-deps 之前——它内部那次 apt 同样走镜像。
# 主源偶发 502(2026-11-13 实测:阿里云源拉 deb 包时连续两次 502/连接失败,
# 致同批镜像构建红)——deb822 的 URIs 可列多个源,apt 逐个回退,故加备用源。
ARG APT_MIRROR_HOST="mirrors.aliyun.com"
ARG APT_MIRROR_FALLBACK_HOST="mirrors.tuna.tsinghua.edu.cn"

# 依赖层:uv 按 uv.lock 精确安装(--frozen 禁重解析;网关为虚拟项目,--no-install-project
# 只装依赖);uv 经 pip 引导(仿 ai-invest);playwright CLI 取自 venv 装 chromium
COPY services/douyin-gateway/pyproject.toml services/douyin-gateway/uv.lock ./
RUN if [ -n "$APT_MIRROR_HOST" ]; then \
      sed -i "s|https\?://deb\.debian\.org|http://${APT_MIRROR_HOST}|g; s|https\?://security\.debian\.org|http://${APT_MIRROR_HOST}|g" \
        /etc/apt/sources.list.d/debian.sources; \
      if [ -n "$APT_MIRROR_FALLBACK_HOST" ]; then \
        sed -i -E "s|^URIs: (http://${APT_MIRROR_HOST}(/[^[:space:]]+))$|URIs: \1 http://${APT_MIRROR_FALLBACK_HOST}\2|" \
          /etc/apt/sources.list.d/debian.sources; \
      fi; \
    fi \
  && pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --no-install-project \
    && playwright install --with-deps chromium

COPY services/douyin-gateway/app/ ./app/

# 单 worker:进程内有状态运行时(jar 冷却/签名槽位),禁多 worker 横向分叉
# 登录态与贴图图片由 compose 卷挂载(xhs-state rw / media ro),不在镜像内
CMD ["uvicorn", "app.gateway:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]

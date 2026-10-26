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

# 依赖层:uv 按 uv.lock 精确安装(--frozen 禁重解析;网关为虚拟项目,--no-install-project
# 只装依赖);uv 经 pip 引导(仿 ai-invest);playwright CLI 取自 venv 装 chromium
COPY services/douyin-gateway/pyproject.toml services/douyin-gateway/uv.lock ./
RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --no-install-project \
    && playwright install --with-deps chromium

COPY services/douyin-gateway/app/ ./app/

# 单 worker:进程内有状态运行时(jar 冷却/签名槽位),禁多 worker 横向分叉
# 登录态与贴图图片由 compose 卷挂载(xhs-state rw / media ro),不在镜像内
CMD ["uvicorn", "app.gateway:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]

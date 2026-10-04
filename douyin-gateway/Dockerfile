# 抖音数据网关:签名(Playwright chromium 常驻页)+ 数据端点(curl_cffi Chrome TLS 指纹)
# 内网 only:compose 里不发布端口;本地冒烟由 dev compose 映射 127.0.0.1:8010
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt \
    && playwright install --with-deps chromium

COPY app/ ./app/

# 单 worker:进程内有状态运行时(jar 冷却/签名槽位),禁多 worker 横向分叉
CMD ["uvicorn", "app.gateway:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "1"]

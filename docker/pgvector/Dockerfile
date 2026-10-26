# postgres:16-alpine + pgvector 源码编译(M20 混合检索)
# 不用官方 pgvector/pgvector:pg16(Debian):存量 PGDATA 由 alpine/musl 初始化,
# datcollversion 为空,换 glibc 底座会无警告静默改变文本排序(collation 错配)。
# 约束:底座必须与 postgres:16-alpine 同大版本;升级 PG 时同步 bump ARG。
# 多架构:本机 arm64(dev)与 175 amd64(生产)各 build 一次,tag 见 docker-compose*.yml
FROM postgres:16-alpine

ARG PGVECTOR_VERSION=v0.8.7

RUN apk add --no-cache --virtual .pgvector-build git build-base postgresql16-dev \
 && git clone --branch "${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && make -C /tmp/pgvector with_llvm=no -j"$(nproc)" \
 && make -C /tmp/pgvector with_llvm=no install \
 && apk del .pgvector-build
